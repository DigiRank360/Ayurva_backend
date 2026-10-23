const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret';
const service = require('../services/mlmRegistrationService');

const validPayout = {
    pan: 'abcde1234f',
    accountHolderName: 'Rajeshwar  Sharma',
    accountNumber: '123456789012',
    confirmAccountNumber: '123456789012',
    ifsc: 'hdfc0001234',
};

test('payout details are skipped when secure storage is not configured and none are sent', () => {
    delete process.env.KYC_ENCRYPTION_KEY;
    assert.equal(service.buildPayoutAccount(undefined, 'Rajeshwar Sharma'), null);
    assert.throws(() => service.buildPayoutAccount(validPayout, 'x'), /not configured/);
});

test('payout details are validated and encrypted', () => {
    process.env.KYC_ENCRYPTION_KEY = 'a'.repeat(64);
    const result = service.buildPayoutAccount(validPayout, 'rajeshwar sharma');
    assert.equal(result.panLastFour, '234F');
    assert.equal(result.accountNumberLastFour, '9012');
    assert.equal(result.ifsc, 'HDFC0001234');
    assert.equal(result.holderNameMatchesLegalName, true);
    assert.ok(!result.panEncrypted.includes(Buffer.from('ABCDE1234F')));
    assert.throws(() => service.buildPayoutAccount({ ...validPayout, pan: 'BAD' }, 'x'), /valid 10-character PAN/);
    assert.throws(() => service.buildPayoutAccount({ ...validPayout, ifsc: 'BAD' }, 'x'), /IFSC/);
    assert.throws(() => service.buildPayoutAccount({ ...validPayout, confirmAccountNumber: '1' }, 'x'), /do not match/);
    assert.throws(() => service.buildPayoutAccount(undefined, 'x'), /required/);
});

test('phone verification is enforced only when Twilio Verify is configured', () => {
    delete process.env.Twilio_ACCOUNT_SID;
    assert.doesNotThrow(() => service.assertPhoneVerified('+919876543210', undefined));
    process.env.Twilio_ACCOUNT_SID = 'sid';
    process.env.Twilio_AUTH_TOKEN = 'token';
    process.env.TWILIO_VERIFY_SERVICE_SID = 'vs';
    assert.throws(() => service.assertPhoneVerified('+919876543210', undefined), /Verify your mobile/);
    const token = jwt.sign({ purpose: 'mlm-phone-verification', phone: '+919876543210' }, process.env.JWT_SECRET);
    assert.doesNotThrow(() => service.assertPhoneVerified('+919876543210', token));
    assert.throws(() => service.assertPhoneVerified('+919999999999', token), /Verify your mobile/);
    delete process.env.Twilio_ACCOUNT_SID;
});
