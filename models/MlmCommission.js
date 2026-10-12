const mongoose = require('mongoose');

const mlmCommissionSchema = new mongoose.Schema({
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'MlmMember', required: true, index: true },
    sourceMember: { type: mongoose.Schema.Types.ObjectId, ref: 'MlmMember', default: null },
    type: { type: String, enum: ['referral', 'binary'], required: true },
    dateKey: { type: String, required: true, index: true },
    idempotencyKey: { type: String, required: true, unique: true },
    matchedPairs: { type: Number, default: 0 },
    grossAmount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, required: true, min: 0 },
    flushedAmount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['paid', 'flushed'], default: 'paid' },
}, { timestamps: true });

mlmCommissionSchema.index({ member: 1, createdAt: -1 });

module.exports = mongoose.model('MlmCommission', mlmCommissionSchema);