const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateDailyMatching } = require('../utils/binaryMatching');

test('the first left-heavy match requires 2 left members and 1 right member', () => {
    const result = calculateDailyMatching({ packageId: 'starter', leftMembers: 2, rightMembers: 1 });

    assert.equal(result.matchedPairs, 1);
    assert.equal(result.grossIncome, 179);
    assert.equal(result.firstMatchCompleted, true);
    assert.equal(result.remainingLeftMembers, 0);
    assert.equal(result.remainingRightMembers, 0);
});

test('the first right-heavy match requires 1 left member and 2 right members', () => {
    const result = calculateDailyMatching({ packageId: 'growth', leftMembers: 1, rightMembers: 2 });

    assert.equal(result.matchedPairs, 1);
    assert.equal(result.grossIncome, 269);
    assert.equal(result.firstMatchCompleted, true);
});

test('all later matches use 1:1 and leave unmatched members for the next run', () => {
    const result = calculateDailyMatching({
        packageId: 'elite',
        leftMembers: 4,
        rightMembers: 3,
        firstMatchCompleted: true,
    });

    assert.equal(result.matchedPairs, 3);
    assert.equal(result.grossIncome, 1347);
    assert.equal(result.remainingLeftMembers, 1);
    assert.equal(result.remainingRightMembers, 0);
});

test('unqualified first-match counts carry forward without a payout', () => {
    const result = calculateDailyMatching({ packageId: 'starter', leftMembers: 1, rightMembers: 1 });

    assert.equal(result.matchedPairs, 0);
    assert.equal(result.firstMatchCompleted, false);
    assert.equal(result.remainingLeftMembers, 1);
    assert.equal(result.remainingRightMembers, 1);
});

test('daily cap flushes excess income without carrying it forward', () => {
    const result = calculateDailyMatching({
        packageId: 'starter',
        leftMembers: 8,
        rightMembers: 7,
        firstMatchCompleted: true,
        dailyMatchingIncome: 900,
    });

    assert.equal(result.grossIncome, 1253);
    assert.equal(result.payableIncome, 100);
    assert.equal(result.flushedIncome, 1153);
    assert.equal(result.dailyMatchingIncome, 1000);
});