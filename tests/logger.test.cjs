'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { logger } = require('../lib/logger');

test('logger exports expected levels', () => {
  assert.equal(typeof logger.info, 'function');
  assert.equal(typeof logger.error, 'function');
  assert.equal(typeof logger.warn, 'function');
  assert.equal(typeof logger.debug, 'function');
  assert.equal(typeof logger.requestError, 'function');
});
