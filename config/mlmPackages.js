const MLM_PACKAGES = Object.freeze({
    starter: Object.freeze({
        id: 'starter',
        name: 'Sugar Wellness Combo — 3-Month Pack',
        description: 'Ayuveda Fiber, Ayuveda Shots and Ayuveda Diabetic Oil.',
        contents: Object.freeze(['Ayuveda Fiber × 3 packs', 'Ayuveda Shots × 3 packs', 'Ayuveda Diabetic Oil × 3 packs']),
        mrp: 14999,
        discountedPrice: 10000,
        businessVolume: 1199,
        matchingBonus: Math.floor(1199 * 0.15),
        dailyMatchingCap: 1000,
    }),
    growth: Object.freeze({
        id: 'growth',
        name: 'Sexual Wellness Combo — 3-Month Pack',
        description: 'Ayuveda Power Capsules, Ayuveda Shilajit Resin and Ayuveda Vigour Oil.',
        contents: Object.freeze(['Ayuveda Power Capsules × 3 packs', 'Ayuveda Shilajit Resin × 3 packs', 'Ayuveda Vigour Oil × 3 packs']),
        mrp: 14999,
        discountedPrice: 10000,
        businessVolume: 1799,
        matchingBonus: Math.floor(1799 * 0.15),
        dailyMatchingCap: 2000,
    }),
    elite: Object.freeze({
        id: 'elite',
        name: 'Sugar Wellness Jumbo Pack — 3-Month Supply',
        description: 'A multi-pack bundle of selected AyuvaPro products. Exact contents are confirmed at order.',
        contents: Object.freeze([]),
        mrp: 14999,
        discountedPrice: 9999,
        businessVolume: 2999,
        matchingBonus: Math.floor(2999 * 0.15),
        dailyMatchingCap: 3000,
    }),
});

module.exports = MLM_PACKAGES;