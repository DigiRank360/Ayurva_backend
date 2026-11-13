const AffiliateCampaign = require('../models/AffiliateCampaign');
const AffiliateCommissionRule = require('../models/AffiliateCommissionRule');
const AffiliatePackage = require('../models/AffiliatePackage');
const Product = require('../models/Product');
const { writeAudit } = require('./affiliateAuditService');
const { getActiveConfig } = require('./affiliateConfigService');
const { runInTransaction } = require('./affiliateLedgerService');
const { fromMinorUnits, percentageOfMinorUnits, toMinorUnits } = require('../utils/affiliateMoney');

function catalogError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function requireReason(reason) {
    if (typeof reason !== 'string' || reason.trim().length < 5) {
        throw catalogError('A clear change reason is required.');
    }
    return reason.trim();
}

function moneyToMinor(value, field) {
    try {
        return toMinorUnits(value);
    } catch {
        throw catalogError(`${field} must be a valid amount with at most two decimal places.`);
    }
}

async function createPackageDraft(input, actor, req) {
    const reason = requireReason(input.changeReason);
    const code = String(input.code || '').toUpperCase();
    if (!['SILVER', 'GOLD'].includes(code)) throw catalogError('Package code must be SILVER or GOLD.');
    if (typeof input.name !== 'string' || !input.name.trim()) throw catalogError('Package name is required.');
    if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 50) {
        throw catalogError('A package requires between 1 and 50 product lines.');
    }
    const seen = new Set();
    const itemInputs = input.items.map((item) => {
        const product = String(item.product || '');
        const quantity = Number(item.quantity);
        if (!/^[a-f\d]{24}$/i.test(product) || !Number.isInteger(quantity) || quantity < 1 || quantity > 100 || seen.has(product)) {
            throw catalogError('Package product IDs must be unique and quantities must be between 1 and 100.');
        }
        seen.add(product);
        return { product, quantity };
    });
    const products = await Product.find({ _id: { $in: [...seen] }, isActive: true });
    if (products.length !== seen.size) throw catalogError('One or more package products are unavailable.', 409);
    const productMap = new Map(products.map((product) => [String(product._id), product]));
    const items = itemInputs.map(({ product: id, quantity }) => {
        const product = productMap.get(id);
        return {
            product: product._id,
            quantity,
            nameSnapshot: product.name,
            unitPriceSnapshot: fromMinorUnits(toMinorUnits(product.price)),
        };
    });
    const allocatedMinor = items.reduce((total, item) => total + toMinorUnits(item.unitPriceSnapshot) * item.quantity, 0);
    const offerPriceMinor = moneyToMinor(input.offerPrice, 'Offer price');
    const mrpMinor = moneyToMinor(input.mrp, 'MRP');
    const videoRewardMinor = moneyToMinor(input.videoReward, 'Video reward');
    if (!Number.isSafeInteger(allocatedMinor) || offerPriceMinor !== allocatedMinor || mrpMinor < offerPriceMinor
        || offerPriceMinor <= 0 || videoRewardMinor < 0) {
        throw catalogError('Package pricing must match the product allocation and offer price cannot exceed MRP.');
    }
    if (!Number.isInteger(Number(input.durationMonths)) || Number(input.durationMonths) < 1 || Number(input.durationMonths) > 36
        || !Number.isInteger(Number(input.dailyReferralCap)) || Number(input.dailyReferralCap) < 0 || Number(input.dailyReferralCap) > 1000
        || !Number.isInteger(Number(input.rewardWindowDays)) || Number(input.rewardWindowDays) < 1 || Number(input.rewardWindowDays) > 3650
        || !Number.isInteger(Number(input.doctorSessionsPerMonth || 0)) || Number(input.doctorSessionsPerMonth || 0) < 0
        || Number(input.doctorSessionsPerMonth || 0) > 100) {
        throw catalogError('Package duration, referral cap, reward window or support-session quantity is invalid.');
    }
    const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
    if (!Number.isFinite(effectiveFrom.getTime())) throw catalogError('Package effective start date is invalid.');
    const latest = await AffiliatePackage.findOne({ code }).sort({ version: -1 }).select('version');
    const packageRecord = await AffiliatePackage.create({
        code,
        name: input.name.trim(),
        version: (latest?.version || 0) + 1,
        active: false,
        effectiveFrom,
        effectiveTo: null,
        durationMonths: input.durationMonths,
        mrp: fromMinorUnits(mrpMinor),
        offerPrice: fromMinorUnits(offerPriceMinor),
        videoReward: fromMinorUnits(videoRewardMinor),
        dailyReferralCap: input.dailyReferralCap,
        rewardWindowDays: input.rewardWindowDays,
        doctorSessionsPerMonth: input.doctorSessionsPerMonth || 0,
        items,
        changeReason: reason,
        createdBy: actor,
    });
    await writeAudit({
        actor,
        action: 'AFFILIATE_PACKAGE_DRAFT_CREATED',
        resourceType: 'AffiliatePackage',
        resourceId: packageRecord._id,
        after: { code, version: packageRecord.version, offerPrice: packageRecord.offerPrice.toString() },
        reason,
        req,
    });
    return packageRecord;
}

async function activatePackage(packageId, actor, req) {
    return runInTransaction(async (session) => {
        const packageRecord = await AffiliatePackage.findById(packageId).session(session);
        if (!packageRecord) throw catalogError('Package was not found.', 404);
        if (packageRecord.effectiveFrom > new Date()) throw catalogError('Future packages can only be activated when their effective period begins.', 409);
        const active = await AffiliatePackage.findOne({
            code: packageRecord.code,
            active: true,
            _id: { $ne: packageRecord._id },
        }).session(session);
        if (active) {
            active.active = false;
            active.effectiveTo = packageRecord.effectiveFrom;
            await active.save({ session });
        }
        packageRecord.active = true;
        packageRecord.effectiveTo = null;
        await packageRecord.save({ session });
        await writeAudit({
            actor,
            action: 'AFFILIATE_PACKAGE_ACTIVATED',
            resourceType: 'AffiliatePackage',
            resourceId: packageRecord._id,
            after: { code: packageRecord.code, version: packageRecord.version, active: true },
            reason: packageRecord.changeReason,
            req,
            session,
        });
        return packageRecord;
    });
}

async function createCommissionRule(input, actor, req) {
    const reason = requireReason(input.changeReason);
    const code = String(input.packageCode || '').toUpperCase();
    const base = input.commissionBase;
    if (!['SILVER', 'GOLD'].includes(code) || !['NET_COLLECTED', 'OFFER_PRICE', 'CUSTOM'].includes(base)) {
        throw catalogError('Package code or commission base is invalid.');
    }
    const config = await getActiveConfig();
    if (!config) throw catalogError('Create and activate an affiliate policy version before commission rules.', 503);
    if (base !== config.commissionBasePolicy) throw catalogError('Commission base must match the active approved programme policy.', 409);
    try {
        percentageOfMinorUnits(10000, input.ratePercent);
    } catch {
        throw catalogError('Commission rate must be a percentage between 0 and 100.');
    }
    if (!Number.isInteger(Number(input.settlementDays)) || Number(input.settlementDays) < 0 || Number(input.settlementDays) > 365) {
        throw catalogError('Settlement days must be between 0 and 365.');
    }
    const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
    if (!Number.isFinite(effectiveFrom.getTime())) throw catalogError('Commission rule effective start date is invalid.');
    const latest = await AffiliateCommissionRule.findOne({ packageCode: code }).sort({ version: -1 }).select('version');
    const rule = await AffiliateCommissionRule.create({
        packageCode: code,
        version: (latest?.version || 0) + 1,
        active: false,
        ratePercent: String(input.ratePercent),
        commissionBase: base,
        effectiveFrom,
        effectiveTo: null,
        settlementDays: input.settlementDays,
        changeReason: reason,
        createdBy: actor,
    });
    await writeAudit({
        actor,
        action: 'AFFILIATE_COMMISSION_RULE_DRAFT_CREATED',
        resourceType: 'AffiliateCommissionRule',
        resourceId: rule._id,
        after: { packageCode: code, version: rule.version, ratePercent: rule.ratePercent.toString() },
        reason,
        req,
    });
    return rule;
}

async function activateCommissionRule(ruleId, actor, req) {
    return runInTransaction(async (session) => {
        const rule = await AffiliateCommissionRule.findById(ruleId).session(session);
        if (!rule) throw catalogError('Commission rule was not found.', 404);
        const config = await getActiveConfig(session);
        if (!config) throw catalogError('Create and activate an affiliate policy version before commission rules.', 503);
        if (rule.commissionBase !== config.commissionBasePolicy) {
            throw catalogError('Commission rule base no longer matches the active programme policy.', 409);
        }
        if (rule.effectiveFrom > new Date()) throw catalogError('Future rules can only be activated when their effective period begins.', 409);
        const active = await AffiliateCommissionRule.findOne({
            packageCode: rule.packageCode,
            active: true,
            _id: { $ne: rule._id },
        }).session(session);
        if (active) {
            active.active = false;
            active.effectiveTo = rule.effectiveFrom;
            await active.save({ session });
        }
        rule.active = true;
        rule.effectiveTo = null;
        await rule.save({ session });
        await writeAudit({
            actor,
            action: 'AFFILIATE_COMMISSION_RULE_ACTIVATED',
            resourceType: 'AffiliateCommissionRule',
            resourceId: rule._id,
            after: { packageCode: rule.packageCode, version: rule.version, active: true },
            reason: rule.changeReason,
            req,
            session,
        });
        return rule;
    });
}

function validateCampaignDates(startsAt, endsAt) {
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
        throw catalogError('Campaign start and end dates are invalid.');
    }
    return { start, end };
}

async function createCampaign(input, actor, req) {
    const reason = requireReason(input.changeReason);
    let url;
    try {
        url = new URL(input.videoUrl);
    } catch {
        throw catalogError('Campaign video URL is invalid.');
    }
    if (typeof input.name !== 'string' || !input.name.trim()
        || typeof input.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) {
        throw catalogError('Campaign name and URL-safe slug are required.');
    }
    if (url.protocol !== 'https:') throw catalogError('Campaign video URL must use HTTPS.');
    const { start, end } = validateCampaignDates(input.startsAt, input.endsAt);
    const duration = Number(input.videoDurationSeconds);
    const minimumWatch = Number(input.minimumWatchSeconds);
    if (!Number.isInteger(duration) || duration < 1 || minimumWatch < 1 || minimumWatch > duration) {
        throw catalogError('Campaign video duration and minimum watch time are invalid.');
    }
    const campaign = await AffiliateCampaign.create({
        name: input.name,
        slug: input.slug,
        videoUrl: url.toString(),
        videoDurationSeconds: duration,
        minimumWatchSeconds: minimumWatch,
        minimumWatchPercent: input.minimumWatchPercent,
        startsAt: start,
        endsAt: end,
        status: 'DRAFT',
        createdBy: actor,
        changeReason: reason,
    });
    await writeAudit({
        actor,
        action: 'AFFILIATE_CAMPAIGN_CREATED',
        resourceType: 'AffiliateCampaign',
        resourceId: campaign._id,
        after: { slug: campaign.slug, status: campaign.status },
        reason,
        req,
    });
    return campaign;
}

async function updateCampaignDraft(campaignId, values, actor, req) {
    const allowed = ['name', 'videoUrl', 'videoDurationSeconds', 'minimumWatchSeconds', 'minimumWatchPercent', 'startsAt', 'endsAt', 'changeReason'];
    const unsupported = Object.keys(values || {}).filter((key) => !allowed.includes(key));
    if (unsupported.length) throw catalogError(`Unsupported campaign fields: ${unsupported.join(', ')}.`);
    const campaign = await AffiliateCampaign.findOne({ _id: campaignId, status: 'DRAFT' });
    if (!campaign) throw catalogError('Only draft campaigns can be edited.', 409);
    const before = {};
    for (const [field, value] of Object.entries(values || {})) {
        before[field] = campaign.get(field);
        if (field !== 'changeReason') campaign.set(field, value);
    }
    campaign.changeReason = requireReason(values.changeReason);
    await campaign.save();
    await writeAudit({
        actor,
        action: 'AFFILIATE_CAMPAIGN_DRAFT_UPDATED',
        resourceType: 'AffiliateCampaign',
        resourceId: campaign._id,
        before,
        after: values,
        reason: campaign.changeReason,
        req,
    });
    return campaign;
}

async function activateCampaign(campaignId, actor, req) {
    const campaign = await AffiliateCampaign.findOne({ _id: campaignId, status: 'DRAFT' });
    if (!campaign) throw catalogError('Campaign draft was not found.', 404);
    if (campaign.startsAt > new Date() || campaign.endsAt <= new Date()) {
        throw catalogError('Only campaigns within their effective date range can be activated.', 409);
    }
    campaign.status = 'ACTIVE';
    await campaign.save();
    await writeAudit({
        actor,
        action: 'AFFILIATE_CAMPAIGN_ACTIVATED',
        resourceType: 'AffiliateCampaign',
        resourceId: campaign._id,
        after: { status: campaign.status },
        reason: campaign.changeReason,
        req,
    });
    return campaign;
}

module.exports = {
    activateCampaign,
    activateCommissionRule,
    activatePackage,
    createCampaign,
    createCommissionRule,
    createPackageDraft,
    updateCampaignDraft,
};
