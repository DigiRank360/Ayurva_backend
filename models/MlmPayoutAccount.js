const mongoose = require('mongoose');

// Payout/settlement details captured at registration. PAN and account number are
// AES-256-GCM encrypted and never selected or returned by default.
const mlmPayoutAccountSchema = new mongoose.Schema({
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'MlmMember', required: true, unique: true },
    status: { type: String, enum: ['pending_review', 'verified', 'rejected'], default: 'pending_review', index: true },
    panEncrypted: { type: Buffer, required: true, select: false },
    panIv: { type: Buffer, required: true, select: false },
    panAuthTag: { type: Buffer, required: true, select: false },
    panHash: { type: String, required: true, unique: true, select: false },
    panLastFour: { type: String, required: true },
    accountHolderName: { type: String, required: true, trim: true, maxlength: 120 },
    accountNumberEncrypted: { type: Buffer, required: true, select: false },
    accountNumberIv: { type: Buffer, required: true, select: false },
    accountNumberAuthTag: { type: Buffer, required: true, select: false },
    accountNumberLastFour: { type: String, required: true },
    holderNameMatchesLegalName: { type: Boolean, default: false },
    ifsc: { type: String, required: true, uppercase: true, trim: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('MlmPayoutAccount', mlmPayoutAccountSchema);
