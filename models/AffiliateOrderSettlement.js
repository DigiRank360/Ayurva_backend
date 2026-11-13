const mongoose = require('mongoose');

const affiliateOrderSettlementSchema = new mongoose.Schema({
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    status: { type: String, enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'BLOCKED', 'FAILED'], default: 'PENDING', index: true },
    attempts: { type: Number, default: 0, min: 0 },
    lastAttemptAt: { type: Date, default: null },
    lockUntil: { type: Date, default: null },
    lastErrorCode: { type: String, default: null, maxlength: 120 },
    completedAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw' });

affiliateOrderSettlementSchema.index({ status: 1, lockUntil: 1, updatedAt: 1 });

module.exports = mongoose.model('AffiliateOrderSettlement', affiliateOrderSettlementSchema);
