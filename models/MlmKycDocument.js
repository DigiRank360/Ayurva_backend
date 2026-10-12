const mongoose = require('mongoose');

const mlmKycDocumentSchema = new mongoose.Schema({
    application: { type: mongoose.Schema.Types.ObjectId, ref: 'MlmKyc', required: true },
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'MlmMember', required: true, index: true },
    type: { type: String, enum: ['pan', 'identity'], required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, enum: ['application/pdf', 'image/jpeg', 'image/png'], required: true },
    encryptedContents: { type: Buffer, required: true, select: false },
    iv: { type: Buffer, required: true, select: false },
    authTag: { type: Buffer, required: true, select: false },
    sha256: { type: String, required: true, select: false },
}, { timestamps: true });

mlmKycDocumentSchema.index({ application: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('MlmKycDocument', mlmKycDocumentSchema);