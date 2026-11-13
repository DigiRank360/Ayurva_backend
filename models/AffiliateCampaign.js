const mongoose = require('mongoose');

const affiliateCampaignSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, lowercase: true, trim: true, unique: true },
    status: { type: String, enum: ['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED'], default: 'DRAFT', index: true },
    videoUrl: { type: String, trim: true, maxlength: 2048 },
    videoDurationSeconds: { type: Number, min: 1, max: 86400 },
    minimumWatchSeconds: { type: Number, min: 1, max: 86400 },
    minimumWatchPercent: { type: Number, min: 1, max: 100 },
    startsAt: { type: Date },
    endsAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    changeReason: { type: String, required: true, maxlength: 500 },
}, { timestamps: true, strict: 'throw' });

affiliateCampaignSchema.index({ status: 1, startsAt: 1, endsAt: 1 });

module.exports = mongoose.model('AffiliateCampaign', affiliateCampaignSchema);
