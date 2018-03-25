'use strict';

const moment = require('moment');
const Promise = require('bluebird');
const _ = require('lodash');
const rp = require('request-promise');
const fixy = require('fixy');
const neatCsv = require('neat-csv');
const numeral = require('numeral');
const fs = require('fs');
const tempy = require('tempy');
const unzipper = require('unzipper');
const readdir = require('fs-readdir-promise');
const XLSX = require('xlsx');
const path = require('path');

const USER_AGENT = "idxdata";
const MARKET_INDEX_URL = "http://www.idxdata2.co.id/Market_Summary/Market_Indices";
const SECURITY_ID_URL = "http://www.idxdata2.co.id/Download_Data/SecurityID";
const INDEX_WEIGHT_URL = "http://www.idxdata2.co.id/Download_Data/Daily/Index_Weight";

const download = (url, expectedMime) => {
    let options = {
        uri: url,
        qs: {},
        headers: {
            'User-Agent': USER_AGENT
        },
        resolveWithFullResponse: true
    };

    return rp(options)
        .then((result) => {
            if (result.statusCode === 200 && result.headers['content-type'].indexOf(expectedMime) > -1)
                return result.body; else
                return Promise.reject("Data not available");
        })
};

const parseMarketIndex = (data) => {
    let lines = data.replace(/\r\n/g, '\n').split("\n");
    lines = lines.splice(13, lines.length - 15);
    return fixy.parse({
        map: [
            {
                name: "name",
                width: 32,
                start: 6,
                type: "string"
            },
            {
                name: "open",
                width: 8,
                start: 40,
                type: "float",
                percision: 3
            },
            {
                name: "high",
                width: 8,
                start: 49,
                type: "float",
                percision: 3
            },
            {
                name: "low",
                width: 8,
                start: 57,
                type: "float",
                percision: 3
            },
            {
                name: "close",
                width: 8,
                start: 66,
                type: "float",
                percision: 3
            },
            {
                name: "change",
                width: 9,
                start: 76,
                type: "float",
                percision: 3
            },
            {
                name: "volume",
                width: 15,
                start: 93,
                type: "integer"
            },
            {
                name: "value",
                width: 19,
                start: 109,
                type: "integer"
            },
            {
                name: "freq",
                width: 7,
                start: 130,
                type: "integer"
            }
        ],
        options: {
            fullwidth: 160,
            skiplines: null,
            format: "json"
        }
    }, lines.join("\n"));
};

const getMarketIndex = (date) => {
    const url = MARKET_INDEX_URL + "/IX" + date.format("YYMMDD") + ".TXT";
    return download(url, 'text/plain')
        .then((result) => {
            return parseMarketIndex(result);
        })
        .map((item) => {
            item.date = date;
            item.volume = numeral(item.volume).value();
            item.value = numeral(item.value).value();
            item.freq = numeral(item.freq).value();
            item.open = numeral(item.open).value();
            item.change = numeral(item.change).value();
            item.low = numeral(item.low).value();
            item.high = numeral(item.high).value();
            item.close = numeral(item.close).value();

            if (item.low > item.high)
                return Promise.reject("Data inconsistency detected (l>h)." + JSON.stringify(item));
            if (item.close < item.low)
                return Promise.reject("Data inconsistency detected (c<l)." + JSON.stringify(item));
            if (item.close > item.high)
                return Promise.reject("Data inconsistency detected (c>h)." + JSON.stringify(item));

            return item;
        });
};

module.exports.getMarketIndex = (date) => {
    let context = null;
    if (!date) {
        if (moment().day() >= 1 && moment().day() <= 5)
            context = moment().endOf('day'); else  // Weekdays
            context = moment().day(-2).endOf('day'); // All other days, return last friday
    } else {
        context = moment(date).endOf('day');
    }

    return getMarketIndex(context);
};

const getSecurityId = (date) => {
    const url = SECURITY_ID_URL + "/SecurityID" + date.format("YYMMDD") + ".csv";
    return download(url, 'text/csv')
        .then((result)=>{
            return neatCsv(result, {
                raw: false,     // do not decode to utf-8 strings
                separator: ',', // specify optional cell separator
                quote: '"',     // specify optional quote character
                escape: '"',    // specify optional escape character (defaults to quote value)
                newline: '\n',  // specify a newline character
                headers: ['id', 'symbol', 'description'] // Specifying the headers
            });
        });
};

module.exports.getSecurityId = (date) => {
    let context = null;
    if (!date) {
        if (moment().day() >= 0 && moment().day() <= 4)
            context = moment().add(1, 'days'); else  // Weekdays
            context = moment().add(1, 'weeks').isoWeekday(1); // All other days, return next monday
    } else {
        context = moment(date);
    }

    return getSecurityId(context);
};

const downloadZip = (url) => {
    let options = {
        uri: url,
        encoding: null,
        headers: {
            'User-Agent': USER_AGENT
        }
    };

    return rp.get(options)
        .then((result) => {
            const buffer = Buffer.from(result, 'utf8');
            const filename = tempy.file({extension: 'zip'});
            fs.writeFileSync(filename, buffer);
            return filename
        })
};

const parseIndexWeightXls = (date, xlsFilename) => {
    const workbook = XLSX.readFile(xlsFilename);
    const sheetNames = workbook.SheetNames;

    let worksheet = workbook.Sheets[sheetNames[0]];
    let headers = {};
    let data = [];
    for (let z in worksheet) {
        if(z[0] === '!') continue;
        //parse out the column, row, and value
        let col = z.substring(0,1);
        let row = parseInt(z.substring(1));
        let value = worksheet[z].v;

        if (row < 3)
            continue;

        //store header names
        if(row === 3) {
            headers[col] = value;
            continue;
        }

        if(!data[row]) data[row]={};
        data[row][headers[col]] = value;
    }

    return Promise.mapSeries(_.compact(data), (item) => {
        return {
            "symbol" : item["Code"],
            "companyName" : item["Name"],
            "shares" : item["Shares for Index"],
            "price" : item["Last Price"],
            "marketCap" : item["Market Capitalization"],
            "weight" : item["Weight (%)"]
        };
    })
        .then((result)=>{
            return {
                "index" : sheetNames[0],
                "date" : date,
                "components" : result
            };
        });
};

const getIndexWeighting = (date) => {
    let directory = null;
    const url = INDEX_WEIGHT_URL + "/BobotIndeks" + date.format("YYMMDD") + ".zip";
    return downloadZip(url)
        .then((filename)=>{
            return new Promise((resolve, reject)=>{
            directory = tempy.directory();
            fs.createReadStream(filename)
                .pipe(unzipper.Extract({ path: directory }))
                .promise()
                .then( () => resolve(directory), e => reject(e));
            })
        })
        .then((directory) => {
            return readdir(directory)
        })
        .mapSeries((filename)=>{
            return parseIndexWeightXls(date, directory+path.sep+filename);
        });
};


module.exports.getIndexWeighting = (date) => {
    let context = null;
    if (!date) {
        if (moment().day() >= 1 && moment().day() <= 5)
            context = moment(); else  // Weekdays
            context = moment().day(-2); // All other days, return last friday
    } else {
        context = moment(date);
    }

    return getIndexWeighting(context);
};