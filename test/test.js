'use strict';

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const assert = chai.assert;
const scraper = require('../index');
const moment = require('moment');

describe('idxdata-scraper', () => {
    it('should returns market index (any day)', () => {
        return assert.isFulfilled(scraper.getMarketIndex());
    });

    it('should returns market index (friday)', () => {
        return assert.isFulfilled(scraper.getMarketIndex(moment().day(-2).toDate()));
    });

    it('should not returns market index (saturday)', () => {
        return assert.isRejected(scraper.getMarketIndex(moment().day(-1).toDate()), "Data not available");
    });

    it('should returns security id for next market day', () => {
        return assert.isFulfilled(scraper.getSecurityId());
    });

    it('should not returns security id (friday)', () => {
        return assert.isRejected(scraper.getSecurityId(moment().add(1, 'weeks').day(-2).toDate()), "Data not available");
    });

    it('should returns index weighting', () => {
        return assert.isFulfilled(scraper.getIndexWeighting());
    }).timeout(10000)
});