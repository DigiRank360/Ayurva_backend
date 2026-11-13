const mongoose = require('mongoose');

const affiliateKycDocumentSchema = new mongoose.Schema({
    application: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateKyc', required: true },
    affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateProfile', required: true, index: true },
    type: { type: String, enum: ['PAN', 'IDENTITY', 'ADDRESS'], required: true },
    originalName: { type: String, required: true, maxlength: 180 },
    mimeType: { type: String, enum: ['application/pdf', 'image/jpeg', 'image/png'], required: true },
    encryptedContents: { type: Buffer, required: true, select: false },
    iv: { type: Buffer, required: true, select: false },
    authTag: { type: Buffer, required: true, select: false },
    sha256: { type: String, required: true, select: false },
}, { timestamps: true, strict: 'throw' });

affiliateKycDocumentSchema.index({ application: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('AffiliateKycDocument', affiliateKycDocumentSchema);
