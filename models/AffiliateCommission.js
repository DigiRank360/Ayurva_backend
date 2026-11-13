const mongoose = require('mongoose');

const affiliateCommissionSchema = new mongoose.Schema({
    affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateProfile', required: true, index: true, immutable: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, immutable: true },
    attribution: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateAttribution', required: true, immutable: true },
    rule: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateCommissionRule', required: true, immutable: true },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'PAYABLE', 'PAID', 'REVERSED', 'ON_HOLD'], default: 'PENDING', index: true },
    currency: { type: String, required: true, default: 'INR', immutable: true },
    baseAmount: { type: mongoose.Schema.Types.Decimal128, required: true, immutable: true },
    ratePercent: { type: mongoose.Schema.Types.Decimal128, required: true, immutable: true },
    commissionAmount: { type: mongoose.Schema.Types.Decimal128, required: true, immutable: true },
    adjustmentAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
    packageSnapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
    ruleSnapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
    approvedAt: { type: Date, default: null },
    payableAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    statusReason: { type: String, default: null, maxlength: 500 },
}, { timestamps: true, strict: 'throw' });

affiliateCommissionSchema.index({ order: 1 }, { unique: true });
affiliateCommissionSchema.index({ affiliate: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('AffiliateCommission', affiliateCommissionSchema);
