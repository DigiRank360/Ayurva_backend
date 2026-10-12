const test = require('node:test');
const assert = require('node:assert/strict');
const MLM_PACKAGES = require('../config/mlmPackages');
const { calculateFundDistribution } = require('../services/mlmDistributionService');
const { validatePayoutDetails } = require('../services/mlmWithdrawalService');
const { getIndiaDateKey, getPreviousIndiaDateKey } = require('../utils/mlmDate');
const { isValidRazorpaySignature } = require('../services/mlmPackagePaymentService');
const crypto = require('crypto');

test('package caps and matching bonuses match the package sheet', () => {
    assert.deepEqual(
        Object.values(MLM_PACKAGES).map(({ businessVolume, matchingBonus, dailyMatchingCap }) => [
            businessVolume,
            matchingBonus,
            dailyMatchingCap,
        ]),
        [[1199, 179, 1000], [1799, 269, 2000], [2999, 449, 3000]],
    );
});

test('fund distribution floors each percentage and reports the rounding remainder', () => {
    const result = calculateFundDistribution(1199);

    assert.deepEqual(result.allocations, {
        productCost: 383,
        profit: 359,
        matchingBonus: 179,
        referralBonus: 59,
        royaltyBonus: 59,
        franchise: 95,
        rewardIncome: 59,
    });
    assert.equal(result.allocated, 1193);
    assert.equal(result.unallocated, 6);
});

test('payout dates follow the India calendar around UTC midnight', () => {
    const utcDate = new Date('2026-10-05T19:00:00.000Z');

    assert.equal(getIndiaDateKey(utcDate), '2026-10-06');
    assert.equal(getPreviousIndiaDateKey(utcDate), '2026-10-05');
});

test('withdrawal details accept valid UPI and bank destinations only', () => {
    assert.equal(validatePayoutDetails({ method: 'upi', upiId: 'member@bank' }).upiId, 'member@bank');
    assert.equal(validatePayoutDetails({
        method: 'bank',
        accountName: 'Member Name',
        accountNumber: '123456789012',
        ifsc: 'HDFC0001234',
    }).method, 'bank');
    assert.throws(() => validatePayoutDetails({ method: 'upi', upiId: 'not-an-upi' }), /valid bank account/);
});

test('Razorpay signature validation accepts the expected HMAC and rejects tampering', () => {
    const input = { orderId: 'order_123', paymentId: 'pay_456', secret: 'test-secret' };
    const signature = crypto.createHmac('sha256', input.secret).update(`${input.orderId}|${input.paymentId}`).digest('hex');

    assert.equal(isValidRazorpaySignature({ ...input, signature }), true);
    assert.equal(isValidRazorpaySignature({ ...input, signature: '00'.repeat(32) }), false);
    assert.equal(isValidRazorpaySignature({ ...input, signature: 'not-hex' }), false);
});