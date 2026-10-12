const MLM_PACKAGES = require('../config/mlmPackages');

function getPackages() {
    return Object.values(MLM_PACKAGES);
}

function getPackage(packageId) {
    const selectedPackage = MLM_PACKAGES[packageId];
    if (!selectedPackage) {
        const error = new Error('Select a valid MLM package.');
        error.statusCode = 400;
        throw error;
    }
    return selectedPackage;
}

module.exports = { getPackages, getPackage };