const mongoose = require('mongoose');

const packageItemSchema = new mongoose.Schema({
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1, max: 100 },
    nameSnapshot: { type: String, required: true, maxlength: 160 },
    unitPriceSnapshot: { type: mongoose.Schema.Types.Decimal128, required: true },
}, { _id: false });

const affiliatePackageSchema = new mongoose.Schema({
    code: { type: String, required: true, enum: ['SILVER', 'GOLD'] },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    version: { type: Number, required: true, min: 1 },
    active: { type: Boolean, default: false, index: true },
    effectiveFrom: { type: Date, required: true, default: Date.now },
    effectiveTo: { type: Date, default: null },
    durationMonths: { type: Number, required: true, min: 1, max: 36 },
    mrp: { type: mongoose.Schema.Types.Decimal128, required: true },
    offerPrice: { type: mongoose.Schema.Types.Decimal128, required: true },
    videoReward: { type: mongoose.Schema.Types.Decimal128, required: true },
    dailyReferralCap: { type: Number, required: true, min: 0, max: 1000 },
    rewardWindowDays: { type: Number, required: true, min: 1, max: 3650 },
    doctorSessionsPerMonth: { type: Number, default: 0, min: 0, max: 100 },
    items: { type: [packageItemSchema], default: [] },
    changeReason: { type: String, required: true, maxlength: 500 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, strict: 'throw' });

affiliatePackageSchema.index({ code: 1, version: 1 }, { unique: true });
affiliatePackageSchema.index({ code: 1, active: 1, effectiveFrom: -1 });
affiliatePackageSchema.index(
    { code: 1 },
    { unique: true, partialFilterExpression: { active: true } },
);

module.exports = mongoose.model('AffiliatePackage', affiliatePackageSchema);
