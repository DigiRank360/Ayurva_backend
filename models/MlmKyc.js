const mongoose = require('mongoose');

const kycAddressSchema = new mongoose.Schema({
    line1: { type: String, required: true },
    line2: { type: String, default: '' },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
}, { _id: false });

const mlmKycSchema = new mongoose.Schema({
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'MlmMember', required: true, unique: true },
    status: { type: String, enum: ['submitted', 'under_review', 'approved', 'rejected'], default: 'submitted', index: true },
    legalName: { type: String, required: true },
    dateOfBirth: { type: Date, required: true },
    panEncrypted: { type: Buffer, required: true, select: false },
    panIv: { type: Buffer, required: true, select: false },
    panAuthTag: { type: Buffer, required: true, select: false },
    panHash: { type: String, required: true, unique: true, select: false },
    panLastFour: { type: String, required: true },
    identityDocumentType: { type: String, enum: ['aadhaar', 'passport', 'voter_id', 'driving_license'], required: true },
    address: { type: kycAddressSchema, required: true },
    submittedAt: { type: Date, default: Date.now },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('MlmKyc', mlmKycSchema);