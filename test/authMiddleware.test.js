const test = require('node:test');
const assert = require('node:assert/strict');
const { getRequestToken } = require('../middleware/authMiddleware');

test('an explicit bearer token takes precedence over an older auth cookie', () => {
    const token = getRequestToken({
        headers: { authorization: 'Bearer newly-issued-token' },
        cookies: { jwt: 'old-cookie-token' },
    });

    assert.equal(token, 'newly-issued-token');
});

test('cookie authentication remains available when no bearer token is sent', () => {
    assert.equal(getRequestToken({ headers: {}, cookies: { jwt: 'cookie-token' } }), 'cookie-token');
});