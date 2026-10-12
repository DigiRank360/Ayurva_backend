const mongoose = require('mongoose');

const mlmPackagePaymentSchema = new mongoose.Schema({
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'MlmMember', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    packageId: { type: String, enum: ['starter', 'growth', 'elite'], required: true },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, unique: true, sparse: true },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    status: { type: String, enum: ['created', 'verified', 'approving', 'approved', 'refund_pending', 'refunding', 'rejected', 'failed'], default: 'created', index: true },
    signature: { type: String, default: null },
    verifiedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    refundId: { type: String, default: null },
    reviewLockToken: { type: String, default: null },
    reviewLockUntil: { type: Date, default: null },
}, { timestamps: true });

mlmPackagePaymentSchema.index({ member: 1, createdAt: -1 });

module.exports = mongoose.model('MlmPackagePayment', mlmPackagePaymentSchema);