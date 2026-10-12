const MlmCommission = require('../models/MlmCommission');
const MlmMember = require('../models/MlmMember');
const MlmPayoutRun = require('../models/MlmPayoutRun');
const MlmVolumeEvent = require('../models/MlmVolumeEvent');
const MlmWithdrawal = require('../models/MlmWithdrawal');
const MlmPackagePayment = require('../models/MlmPackagePayment');
const MlmKyc = require('../models/MlmKyc');
const MlmKycDocument = require('../models/MlmKycDocument');

async function initializeMlmIndexes() {
    await Promise.all([
        MlmMember.init(),
        MlmCommission.init(),
        MlmPayoutRun.init(),
        MlmVolumeEvent.init(),
        MlmWithdrawal.init(),
        MlmPackagePayment.init(),
        MlmKyc.init(),
        MlmKycDocument.init(),
    ]);
}

module.exports = { initializeMlmIndexes };