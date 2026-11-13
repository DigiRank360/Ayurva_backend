const mongoose = require('mongoose');

const affiliatePayoutMethodSchema = new mongoose.Schema({
    affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateProfile', required: true, unique: true, index: true },
    method: { type: String, enum: ['BANK', 'UPI'], required: true },
    holderName: { type: String, required: true, maxlength: 120 },
    accountNumberEncrypted: { type: Buffer, select: false },
    accountNumberIv: { type: Buffer, select: false },
    accountNumberAuthTag: { type: Buffer, select: false },
    upiIdEncrypted: { type: Buffer, select: false },
    upiIdIv: { type: Buffer, select: false },
    upiIdAuthTag: { type: Buffer, select: false },
    ifsc: { type: String, maxlength: 11 },
    destinationLastFour: { type: String, required: true, maxlength: 4 },
    destinationHash: { type: String, required: true, select: false },
    status: { type: String, enum: ['PENDING', 'VERIFIED', 'REJECTED'], default: 'PENDING', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null, maxlength: 500 },
}, { timestamps: true, strict: 'throw' });

module.exports = mongoose.model('AffiliatePayoutMethod', affiliatePayoutMethodSchema);
