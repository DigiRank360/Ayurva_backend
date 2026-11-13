const mongoose = require('mongoose');

const affiliateKycSchema = new mongoose.Schema({
    affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateProfile', required: true, index: true },
    version: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['NOT_SUBMITTED', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'], default: 'NOT_SUBMITTED', index: true },
    legalName: { type: String, required: true, maxlength: 120 },
    dateOfBirth: { type: Date, required: true },
    panEncrypted: { type: Buffer, required: true, select: false },
    panIv: { type: Buffer, required: true, select: false },
    panAuthTag: { type: Buffer, required: true, select: false },
    panHash: { type: String, required: true, unique: true, select: false },
    panLastFour: { type: String, required: true, maxlength: 4 },
    address: {
        line1: { type: String, required: true, maxlength: 160 },
        line2: { type: String, default: '', maxlength: 160 },
        city: { type: String, required: true, maxlength: 80 },
        state: { type: String, required: true, maxlength: 80 },
        postalCode: { type: String, required: true, maxlength: 12 },
    },
    submittedAt: { type: Date, default: Date.now },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null, maxlength: 500 },
}, { timestamps: true, strict: 'throw' });

affiliateKycSchema.index({ affiliate: 1, version: 1 }, { unique: true });

module.exports = mongoose.model('AffiliateKyc', affiliateKycSchema);
