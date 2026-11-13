const mongoose = require('mongoose');

const affiliateWalletAccountSchema = new mongoose.Schema({
    affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateProfile', required: true, unique: true },
    sequence: { type: Number, default: 0, min: 0 },
    updatedAt: { type: Date, default: Date.now },
}, { versionKey: false, strict: 'throw' });

module.exports = mongoose.model('AffiliateWalletAccount', affiliateWalletAccountSchema);
