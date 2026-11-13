const mongoose = require('mongoose');

const affiliateDailyCapSchema = new mongoose.Schema({
    affiliate: { type: mongoose.Schema.Types.ObjectId, ref: 'AffiliateProfile', required: true },
    indiaDateKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    reservedCount: { type: Number, default: 0, min: 0 },
    approvedCount: { type: Number, default: 0, min: 0 },
    createdAt: { type: Date, default: Date.now, immutable: true },
    updatedAt: { type: Date, default: Date.now },
}, { strict: 'throw', versionKey: false });

affiliateDailyCapSchema.index({ affiliate: 1, indiaDateKey: 1 }, { unique: true });

module.exports = mongoose.model('AffiliateDailyCap', affiliateDailyCapSchema);
