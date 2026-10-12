const DISTRIBUTION_PERCENTAGES = require('../config/mlmFundDistribution');

function calculateFundDistribution(businessVolume) {
    if (!Number.isInteger(businessVolume) || businessVolume < 0) {
        throw new TypeError('businessVolume must be a non-negative integer.');
    }

    const allocations = Object.fromEntries(
        Object.entries(DISTRIBUTION_PERCENTAGES).map(([name, percentage]) => [
            name,
            Math.floor((businessVolume * percentage) / 100),
        ]),
    );
    const allocated = Object.values(allocations).reduce((total, amount) => total + amount, 0);

    return {
        businessVolume,
        percentages: DISTRIBUTION_PERCENTAGES,
        allocations,
        allocated,
        unallocated: businessVolume - allocated,
    };
}

module.exports = { calculateFundDistribution };