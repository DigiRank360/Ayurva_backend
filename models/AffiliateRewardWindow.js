const mongoose = require('mongoose');

const affiliateRewardWindowSchema = new mongoose.Schema({
    affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateProfile', required: true, index: true },
    package: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliatePackage', required: true },
    sourceOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, immutable: true },
    sequence: { type: Number, required: true, min: 1 },
    startsAt: { type: Date, required: true, immutable: true },
    endsAt: { type: Date, required: true, immutable: true },
    status: { type: String, enum: ['ACTIVE', 'EXPIRED', 'REVERSED'], default: 'ACTIVE', index: true },
    ruleSnapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
}, { timestamps: true, strict: 'throw' });

affiliateRewardWindowSchema.index({ affiliate: 1, sequence: 1 }, { unique: true });
affiliateRewardWindowSchema.index({ affiliate: 1, status: 1, endsAt: -1 });
affiliateRewardWindowSchema.index({ sourceOrder: 1 }, { unique: true });

module.exports = mongoose.model('AffiliateRewardWindow', affiliateRewardWindowSchema);
