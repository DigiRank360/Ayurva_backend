const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { fromMinorUnits, percentageOfMinorUnits, toMinorUnits } = require('../utils/affiliateMoney');
const { verifyTotp } = require('../utils/totp');
const { encryptSupportNote, decryptSupportNote } = require('../utils/affiliateSupportCrypto');
const { isValidRazorpaySignature } = require('../services/retailPaymentService');
const { optionalProtect, requireAffiliateRoles } = require('../middleware/affiliateAuthorization');

test('affiliate money uses exact paise and basis-point rounding', () => {
    assert.equal(toMinorUnits(mongoose.Types.Decimal128.fromString('12.30')), 1230);
    assert.equal(fromMinorUnits(1230).toString(), '12.30');
    assert.equal(percentageOfMinorUnits(1899, '15'), 285);
    assert.throws(() => toMinorUnits('1.001'), /at most two fractional digits/);
});

test('TOTP accepts the expected SHA-1 test-vector code and rejects malformed codes', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    assert.equal(verifyTotp(secret, '287082', 30_000, 0), true);
    assert.equal(verifyTotp(secret, '28708x', 30_000, 0), false);
});

test('Razorpay payment signatures are matched without accepting altered data', () => {
    const secret = 'test-secret';
    const orderId = 'order_123';
    const paymentId = 'pay_456';
    const signature = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
    assert.equal(isValidRazorpaySignature({ orderId, paymentId, signature, secret }), true);
    const alteredSignature = `${signature[0] === '0' ? '1' : '0'}${signature.slice(1)}`;
    assert.equal(isValidRazorpaySignature({ orderId, paymentId, signature: alteredSignature, secret }), false);
});

test('support notes are authenticated-encrypted with the dedicated key', () => {
    const previousKey = process.env.AFFILIATE_SUPPORT_ENCRYPTION_KEY;
    process.env.AFFILIATE_SUPPORT_ENCRYPTION_KEY = 'ab'.repeat(32);
    try {
        const encrypted = encryptSupportNote('Private doctor note');
        assert.equal(decryptSupportNote(encrypted.encrypted, encrypted.iv, encrypted.authTag), 'Private doctor note');
        const tampered = Buffer.from(encrypted.encrypted);
        tampered[0] ^= 1;
        assert.throws(() => decryptSupportNote(tampered, encrypted.iv, encrypted.authTag));
    } finally {
        if (previousKey === undefined) delete process.env.AFFILIATE_SUPPORT_ENCRYPTION_KEY;
        else process.env.AFFILIATE_SUPPORT_ENCRYPTION_KEY = previousKey;
    }
});

test('privileged affiliate routes require an MFA-verified token', () => {
    const middleware = requireAffiliateRoles('finance_operator');
    const req = { user: { roles: ['finance_operator'] }, auth: { mfaVerified: false } };
    const res = {
        statusCode: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
    let called = false;
    middleware(req, res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 403);
});

test('video referral routes permit guest traffic with optional authentication', () => {
    const router = require('../routes/affiliateRoutes');
    for (const path of ['/videos/:token/start', '/videos/progress']) {
        const layer = router.stack.find((item) => item.route?.path === path && item.route.methods.post);
        assert.ok(layer, `${path} route exists`);
        assert.equal(layer.route.stack[0].handle, optionalProtect);
    }

    let called = false;
    optionalProtect({ headers: {}, cookies: {} }, {}, () => { called = true; });
    assert.equal(called, true);
});
