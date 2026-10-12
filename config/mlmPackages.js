const MLM_PACKAGES = Object.freeze({
    starter: Object.freeze({
        id: 'starter',
        name: 'Starter Wellness',
        mrp: 2400,
        discountedPrice: 1920,
        businessVolume: 1199,
        matchingBonus: Math.floor(1199 * 0.15),
        dailyMatchingCap: 1000,
    }),
    growth: Object.freeze({
        id: 'growth',
        name: 'Growth Plus',
        mrp: 2999,
        discountedPrice: 2400,
        businessVolume: 1799,
        matchingBonus: Math.floor(1799 * 0.15),
        dailyMatchingCap: 2000,
    }),
    elite: Object.freeze({
        id: 'elite',
        name: 'Elite Business',
        mrp: 4999,
        discountedPrice: 4000,
        businessVolume: 2999,
        matchingBonus: Math.floor(2999 * 0.15),
        dailyMatchingCap: 3000,
    }),
});

module.exports = MLM_PACKAGES;