const mongoose = require('mongoose');

const payoutDetailsSchema = new mongoose.Schema({
    method: { type: String, enum: ['bank', 'upi'], required: true },
    accountName: { type: String, default: null },
    bankName: { type: String, default: null },
    accountNumber: { type: String, default: null },
    ifsc: { type: String, default: null },
    upiId: { type: String, default: null },
}, { _id: false });

const mlmWithdrawalSchema = new mongoose.Schema({
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'MlmMember', required: true, index: true },
    amount: { type: Number, required: true, min: 500 },
    payoutDetails: { type: payoutDetailsSchema, required: true },
    status: { type: String, enum: ['pending', 'paid', 'rejected'], default: 'pending', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    paymentReference: { type: String, default: null },
}, { timestamps: true });

mlmWithdrawalSchema.index({ member: 1, createdAt: -1 });

module.exports = mongoose.model('MlmWithdrawal', mlmWithdrawalSchema);