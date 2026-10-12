const MLM_PACKAGES = require('../config/mlmPackages');

function assertNonNegativeInteger(value, fieldName) {
    if (!Number.isInteger(value) || value < 0) {
        throw new TypeError(`${fieldName} must be a non-negative integer.`);
    }
}

function calculateDailyMatching({
    packageId,
    leftMembers = 0,
    rightMembers = 0,
    firstMatchCompleted = false,
    dailyMatchingIncome = 0,
}) {
    const selectedPackage = MLM_PACKAGES[packageId];
    if (!selectedPackage) throw new RangeError(`Unknown MLM package: ${packageId}`);
    assertNonNegativeInteger(leftMembers, 'leftMembers');
    assertNonNegativeInteger(rightMembers, 'rightMembers');
    if (!Number.isFinite(dailyMatchingIncome) || dailyMatchingIncome < 0) {
        throw new TypeError('dailyMatchingIncome must be a non-negative number.');
    }

    let remainingLeftMembers = leftMembers;
    let remainingRightMembers = rightMembers;
    let firstMatchPaid = firstMatchCompleted;
    let matchedPairs = 0;

    if (!firstMatchPaid) {
        if (remainingLeftMembers >= 2 && remainingRightMembers >= 1) {
            remainingLeftMembers -= 2;
            remainingRightMembers -= 1;
            matchedPairs += 1;
            firstMatchPaid = true;
        } else if (remainingLeftMembers >= 1 && remainingRightMembers >= 2) {
            remainingLeftMembers -= 1;
            remainingRightMembers -= 2;
            matchedPairs += 1;
            firstMatchPaid = true;
        }
    }

    if (firstMatchPaid) {
        const nextMatches = Math.min(remainingLeftMembers, remainingRightMembers);
        matchedPairs += nextMatches;
        remainingLeftMembers -= nextMatches;
        remainingRightMembers -= nextMatches;
    }

    const grossIncome = matchedPairs * selectedPackage.matchingBonus;
    const capRoom = Math.max(0, selectedPackage.dailyMatchingCap - dailyMatchingIncome);
    const payableIncome = Math.min(grossIncome, capRoom);

    return {
        matchedPairs,
        grossIncome,
        payableIncome,
        flushedIncome: grossIncome - payableIncome,
        dailyMatchingIncome: dailyMatchingIncome + payableIncome,
        firstMatchCompleted: firstMatchPaid,
        remainingLeftMembers,
        remainingRightMembers,
    };
}

module.exports = { calculateDailyMatching };