const asyncHandler = require('express-async-handler');
const AffiliateCommission = require('../models/AffiliateCommission');
const AffiliateKyc = require('../models/AffiliateKyc');
const AffiliateKycDocument = require('../models/AffiliateKycDocument');
const AffiliatePackage = require('../models/AffiliatePackage');
const AffiliateCommissionRule = require('../models/AffiliateCommissionRule');
const AffiliateCampaign = require('../models/AffiliateCampaign');
const AffiliatePayoutMethod = require('../models/AffiliatePayoutMethod');
const AffiliatePayoutRequest = require('../models/AffiliatePayoutRequest');
const AffiliateProfile = require('../models/AffiliateProfile');
const affiliateService = require('../services/affiliateService');
const referralService = require('../services/affiliateReferralService');
const payoutService = require('../services/affiliatePayoutService');
const kycService = require('../services/affiliateKycService');
const settlementService = require('../services/affiliateSettlementService');
const supportService = require('../services/affiliateSupportService');
const configService = require('../services/affiliateConfigService');
const affiliateOrderService = require('../services/affiliateOrderService');
const catalogService = require('../services/affiliateCatalogService');
const notificationService = require('../services/affiliateUserNotificationService');
const User = require('../models/User');
const { writeAudit } = require('../services/affiliateAuditService');

const enroll = asyncHandler(async (req, res) => {
    const profile = await affiliateService.enrollAffiliate(req.user._id, req.body, req);
    res.status(201).json(profile);
});

const createPackageOrder = asyncHandler(async (req, res) => {
    const order = await affiliateOrderService.createAffiliatePackageOrder(
        req.user._id,
        req.body.packageId,
        req.body.shippingAddress,
        req.get('Idempotency-Key'),
        req,
    );
    res.status(201).json(order);
});

const getProfile = asyncHandler(async (req, res) => {
    res.json(await affiliateService.getAffiliateForUser(req.user._id));
});

const updateProfile = asyncHandler(async (req, res) => {
    res.json(await affiliateService.updateAffiliateProfile(req.user._id, req.body, req));
});

const getPackages = asyncHandler(async (req, res) => {
    res.json(await affiliateService.listActivePackages());
});

const createLink = asyncHandler(async (req, res) => {
    const link = await affiliateService.createReferralLink(req.user._id, req.body, req);
    res.status(201).json(link);
});

const dashboard = asyncHandler(async (req, res) => {
    res.json(await affiliateService.getAffiliateDashboard(req.user._id));
});

const profileStatus = asyncHandler(async (req, res) => {
    res.json(await affiliateService.getProfileStatus(req.user._id));
});

const portalSettings = asyncHandler(async (req, res) => {
    res.json(await configService.getPortalSettings());
});

const referralPolicy = asyncHandler(async (req, res) => {
    res.json(await configService.getPublicReferralPolicy());
});

const activity = asyncHandler(async (req, res) => {
    res.json(await affiliateService.listAffiliateActivity(req.user._id, req.query));
});

const consent = asyncHandler(async (req, res) => {
    const record = await affiliateService.recordConsent(req.user._id, req.body, req);
    res.status(201).json(record);
});

const listNotifications = asyncHandler(async (req, res) => {
    res.json(await notificationService.listNotifications(req.user._id, req.query.page, req.query.limit));
});

const markNotificationRead = asyncHandler(async (req, res) => {
    res.json(await notificationService.markNotificationRead(req.user._id, req.params.notificationId));
});

const trackReferral = asyncHandler(async (req, res) => {
    const result = await referralService.trackReferralVisit(req, res, req.params.token);
    if (result) res.json(result);
});

const startVideo = asyncHandler(async (req, res) => {
    res.status(201).json(await referralService.startVideoSession(req.user?._id || null, req.params.token, req));
});

const recordVideoProgress = asyncHandler(async (req, res) => {
    res.json(await referralService.recordVideoProgress(
        req.user?._id || null,
        req.body.sessionToken,
        req.body.milestone,
    ));
});

const submitKyc = asyncHandler(async (req, res) => {
    const application = await kycService.submitKyc(req.user._id, req.body, req.files, req);
    res.status(201).json(application);
});

const kycStatus = asyncHandler(async (req, res) => {
    res.json(await kycService.getOwnKycStatus(req.user._id));
});

const setPayoutMethod = asyncHandler(async (req, res) => {
    res.status(201).json(await payoutService.setPayoutMethod(req.user._id, req.body, req));
});

const payoutMethod = asyncHandler(async (req, res) => {
    res.json(await payoutService.getPayoutMethod(req.user._id));
});

const requestPayout = asyncHandler(async (req, res) => {
    res.status(201).json(await payoutService.requestPayout(
        req.user._id,
        req.body.amount,
        req.get('Idempotency-Key'),
        req,
    ));
});

const myPayouts = asyncHandler(async (req, res) => {
    res.json(await payoutService.listPayouts(req.user._id, req.query));
});

const reviewPayout = asyncHandler(async (req, res) => {
    res.json(await payoutService.reviewPayout({
        payoutId: req.params.payoutId,
        decision: req.body.decision,
        reason: req.body.reason,
        actor: req.user._id,
        req,
    }));
});

const processPayout = asyncHandler(async (req, res) => {
    res.json(await payoutService.markPayoutProcessing({
        payoutId: req.params.payoutId,
        actor: req.user._id,
        req,
    }));
});

const settlePayout = asyncHandler(async (req, res) => {
    res.json(await payoutService.settlePayout({
        payoutId: req.params.payoutId,
        decision: req.body.decision,
        providerReference: req.body.providerReference,
        reason: req.body.reason,
        actor: req.user._id,
        req,
    }));
});

const reviewPayoutMethod = asyncHandler(async (req, res) => {
    res.json(await payoutService.reviewPayoutMethod({
        methodId: req.params.methodId,
        decision: req.body.decision,
        reason: req.body.reason,
        actor: req.user._id,
        req,
    }));
});

const listKycApplications = asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const filter = req.query.status ? { status: req.query.status } : { status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] } };
    const [items, total] = await Promise.all([
        AffiliateKyc.find(filter)
            .sort({ submittedAt: 1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .select('-panEncrypted -panIv -panAuthTag -panHash')
            .populate('affiliate', 'affiliateId user')
            .lean(),
        AffiliateKyc.countDocuments(filter),
    ]);
    res.json({ items, page, limit, total });
});

const getKycApplication = asyncHandler(async (req, res) => {
    const application = await AffiliateKyc.findById(req.params.applicationId)
        .select('-panEncrypted -panIv -panAuthTag -panHash')
        .populate('affiliate', 'affiliateId user')
        .lean();
    if (!application) {
        res.status(404);
        throw new Error('KYC application not found.');
    }
    const documents = await AffiliateKycDocument.find({ application: application._id })
        .select('type originalName mimeType createdAt')
        .lean();
    res.json({ ...application, documents });
});

const reviewKyc = asyncHandler(async (req, res) => {
    res.json(await kycService.reviewKyc({
        applicationId: req.params.applicationId,
        decision: req.body.decision,
        reason: req.body.reason,
        actor: req.user._id,
        req,
    }));
});

const downloadKycDocument = asyncHandler(async (req, res) => {
    const document = await kycService.getKycDocument(req.params.documentId, req.user._id, req);
    res.set({
        'Content-Type': document.mimeType,
        'Content-Disposition': `attachment; filename="${document.originalName}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    res.send(document.content);
});

const reviewCommission = asyncHandler(async (req, res) => {
    res.json(await settlementService.reviewCommission({
        commissionId: req.params.commissionId,
        decision: req.body.decision,
        reason: req.body.reason,
        actor: req.user._id,
        req,
    }));
});

const reviewVideoReward = asyncHandler(async (req, res) => {
    res.json(await settlementService.reviewVideoReward({
        eventId: req.params.eventId,
        decision: req.body.decision,
        reason: req.body.reason,
        actor: req.user._id,
        req,
    }));
});

const listCommissionQueue = asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const filter = req.query.status ? { status: req.query.status } : { status: { $in: ['PENDING', 'APPROVED'] } };
    const [items, total] = await Promise.all([
        AffiliateCommission.find(filter).sort({ createdAt: 1 }).skip((page - 1) * limit).limit(limit)
            .populate('affiliate', 'affiliateId user')
            .select('-ruleSnapshot -packageSnapshot')
            .lean(),
        AffiliateCommission.countDocuments(filter),
    ]);
    res.json({ items, page, limit, total });
});

const listPayoutQueue = asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const filter = req.query.status ? { status: req.query.status } : { status: { $in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } };
    const [items, total] = await Promise.all([
        AffiliatePayoutRequest.find(filter).sort({ requestedAt: 1 }).skip((page - 1) * limit).limit(limit)
            .populate('affiliate', 'affiliateId user')
            .populate('method', 'method holderName ifsc destinationLastFour status')
            .select('-methodSnapshot')
            .lean(),
        AffiliatePayoutRequest.countDocuments(filter),
    ]);
    res.json({ items, page, limit, total });
});

const listPayoutMethodQueue = asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const [items, total] = await Promise.all([
        AffiliatePayoutMethod.find({ status: 'PENDING' }).sort({ createdAt: 1 })
            .skip((page - 1) * limit).limit(limit)
            .populate('affiliate', 'affiliateId user')
            .select('affiliate method holderName ifsc destinationLastFour status createdAt')
            .lean(),
        AffiliatePayoutMethod.countDocuments({ status: 'PENDING' }),
    ]);
    res.json({ items, page, limit, total });
});

function reportDateFilter(query) {
    const filter = {};
    if (!query.from && !query.to) return filter;
    const from = query.from ? new Date(query.from) : new Date(0);
    const to = query.to ? new Date(query.to) : new Date();
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from
        || to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
        const error = new Error('Report date range must be valid and no longer than 366 days.');
        error.statusCode = 400;
        throw error;
    }
    filter.createdAt = { $gte: from, $lt: to };
    return filter;
}

function csvCell(value) {
    const text = value === null || value === undefined ? '' : String(value);
    const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replace(/"/g, '""')}"`;
}

function sendCsv(res, filename, headers, rows) {
    res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    if (rows.length === 10000) res.set('X-Report-Truncated', 'true');
    res.send([headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n'));
}

const commissionsCsv = asyncHandler(async (req, res) => {
    const filter = reportDateFilter(req.query);
    const records = await AffiliateCommission.find(filter).sort({ createdAt: 1 }).limit(10000)
        .select('affiliate order status currency baseAmount ratePercent commissionAmount adjustmentAmount createdAt approvedAt payableAt paidAt')
        .lean();
    const rows = records.map((record) => [
        record._id,
        record.affiliate,
        record.order,
        record.status,
        record.currency,
        record.baseAmount?.toString(),
        record.ratePercent?.toString(),
        record.commissionAmount?.toString(),
        record.adjustmentAmount?.toString(),
        record.createdAt?.toISOString(),
        record.approvedAt?.toISOString(),
        record.payableAt?.toISOString(),
        record.paidAt?.toISOString(),
    ]);
    sendCsv(res, 'affiliate-commissions.csv', [
        'commission_id', 'affiliate_id', 'order_id', 'status', 'currency', 'base_amount',
        'rate_percent', 'commission_amount', 'adjustment_amount', 'created_at',
        'approved_at', 'payable_at', 'paid_at',
    ], rows);
});

const payoutsCsv = asyncHandler(async (req, res) => {
    const filter = reportDateFilter(req.query);
    const records = await AffiliatePayoutRequest.find(filter).sort({ createdAt: 1 }).limit(10000)
        .select('affiliate amount currency status requestedAt reviewedAt executedAt reviewedBy executedBy')
        .lean();
    const rows = records.map((record) => [
        record._id,
        record.affiliate,
        record.amount?.toString(),
        record.currency,
        record.status,
        record.requestedAt?.toISOString(),
        record.reviewedAt?.toISOString(),
        record.reviewedBy,
        record.executedAt?.toISOString(),
        record.executedBy,
    ]);
    sendCsv(res, 'affiliate-payouts.csv', [
        'payout_id', 'affiliate_id', 'amount', 'currency', 'status', 'requested_at',
        'reviewed_at', 'reviewed_by', 'executed_at', 'executed_by',
    ], rows);
});

const getAdminConfig = asyncHandler(async (req, res) => {
    const config = await configService.getActiveConfig();
    res.json(config ? {
        version: config.version,
        status: config.status,
        featureEnabled: config.featureEnabled,
        attributionWindowDays: config.attributionWindowDays,
        attributionMode: config.attributionMode,
        visitorUniquenessDays: config.visitorUniquenessDays,
        watchThresholdSeconds: config.watchThresholdSeconds,
        dailyCapMode: config.dailyCapMode,
        renewalMode: config.renewalMode,
        qualifyingRenewalTier: config.qualifyingRenewalTier,
        rewardWindowStartConvention: config.rewardWindowStartConvention,
        commissionBasePolicy: config.commissionBasePolicy,
        partialRefundMode: config.partialRefundMode,
        payoutMinimum: config.payoutMinimum,
        payoutCurrency: config.payoutCurrency,
        requiresKycForPayout: config.requiresKycForPayout,
        requiresMakerChecker: config.requiresMakerChecker,
        selfReferralPolicy: config.selfReferralPolicy,
        affiliateAgreementVersion: config.affiliateAgreementVersion,
        termsVersion: config.termsVersion,
        privacyVersion: config.privacyVersion,
        supportConsentVersion: config.supportConsentVersion,
        referralConsentVersion: config.referralConsentVersion,
        kycConsentVersion: config.kycConsentVersion,
        legalApprovalReferences: config.legalApprovalReferences,
        activatedAt: config.activatedAt,
    } : null);
});

const listConfigVersions = asyncHandler(async (req, res) => {
    res.json(await configService.listConfigVersions());
});

const createConfigDraft = asyncHandler(async (req, res) => {
    const config = await configService.createConfigDraft(req.user._id, req.body.reason, req);
    res.status(201).json(config);
});

const updateConfigDraft = asyncHandler(async (req, res) => {
    const config = await configService.updateConfigDraft({
        configId: req.params.configId,
        values: req.body.values,
        reason: req.body.reason,
        actor: req.user._id,
        req,
    });
    res.json(config);
});

const activateConfig = asyncHandler(async (req, res) => {
    const config = await configService.activateConfigVersion({
        configId: req.params.configId,
        actor: req.user._id,
        req,
    });
    res.json(config);
});

const createPackageDraft = asyncHandler(async (req, res) => {
    res.status(201).json(await catalogService.createPackageDraft(req.body, req.user._id, req));
});

const activatePackage = asyncHandler(async (req, res) => {
    res.json(await catalogService.activatePackage(req.params.packageId, req.user._id, req));
});

const listAdminPackages = asyncHandler(async (req, res) => {
    res.json(await AffiliatePackage.find().sort({ code: 1, version: -1 }).lean());
});

const listRiskReviewProfiles = asyncHandler(async (req, res) => {
    const profiles = await AffiliateProfile.find({ riskStatus: { $in: ['PENDING', 'REVIEW', 'BLOCKED'] } })
        .select('affiliateId referralCode user status packageTier riskStatus statusReason activatedAt createdAt')
        .populate('user', 'name email')
        .sort({ createdAt: 1 })
        .limit(100)
        .lean();
    res.json(profiles);
});

const reviewAffiliateRisk = asyncHandler(async (req, res) => {
    if (!/^[a-f\d]{24}$/i.test(req.params.profileId)) {
        res.status(400);
        throw new Error('Affiliate profile ID is invalid.');
    }
    const profile = await settlementService.reviewAffiliateRisk({
        profileId: req.params.profileId,
        decision: req.body.decision,
        reason: req.body.reason,
        actor: req.user._id,
        req,
    });
    res.json({
        affiliateId: profile.affiliateId,
        status: profile.status,
        riskStatus: profile.riskStatus,
        statusReason: profile.statusReason,
    });
});

const createCommissionRule = asyncHandler(async (req, res) => {
    res.status(201).json(await catalogService.createCommissionRule(req.body, req.user._id, req));
});

const activateCommissionRule = asyncHandler(async (req, res) => {
    res.json(await catalogService.activateCommissionRule(req.params.ruleId, req.user._id, req));
});

const listCommissionRules = asyncHandler(async (req, res) => {
    res.json(await AffiliateCommissionRule.find().sort({ packageCode: 1, version: -1 }).lean());
});

const createCampaign = asyncHandler(async (req, res) => {
    res.status(201).json(await catalogService.createCampaign(req.body, req.user._id, req));
});

const updateCampaign = asyncHandler(async (req, res) => {
    res.json(await catalogService.updateCampaignDraft(req.params.campaignId, req.body, req.user._id, req));
});

const activateCampaign = asyncHandler(async (req, res) => {
    res.json(await catalogService.activateCampaign(req.params.campaignId, req.user._id, req));
});

const listCampaigns = asyncHandler(async (req, res) => {
    res.json(await AffiliateCampaign.find().sort({ startsAt: -1 }).lean());
});

const assignUserRoles = asyncHandler(async (req, res) => {
    const allowedRoles = ['customer', 'affiliate_partner', 'support_agent', 'doctor', 'finance_operator', 'affiliate_manager'];
    const roles = req.body.roles;
    if (!Array.isArray(roles) || roles.some((role) => !allowedRoles.includes(role))) {
        res.status(400);
        throw new Error('Provide a valid array of assignable roles.');
    }
    if (String(req.params.userId) === String(req.user._id)) {
        res.status(409);
        throw new Error('Administrators cannot change their own roles.');
    }
    if (typeof req.body.reason !== 'string' || req.body.reason.trim().length < 5) {
        res.status(400);
        throw new Error('A clear reason is required when changing user roles.');
    }
    const target = await User.findById(req.params.userId);
    if (!target) {
        res.status(404);
        throw new Error('User not found.');
    }
    const nextRoles = [...new Set(['customer', ...roles])];
    const before = target.roles;
    target.roles = nextRoles;
    await target.save();
    await writeAudit({
        actor: req.user._id,
        action: 'AFFILIATE_USER_ROLES_UPDATED',
        resourceType: 'User',
        resourceId: target._id,
        before: { roles: before },
        after: { roles: target.roles },
        reason: req.body.reason,
        req,
    });
    res.json({ userId: target._id, roles: target.roles });
});

const reviewRewardAndCommissionLists = {
    activateCampaign,
    activateCommissionRule,
    activateConfig,
    activatePackage,
    assignUserRoles,
    createCampaign,
    createCommissionRule,
    createConfigDraft,
    createPackageDraft,
    createPackageOrder,
    getAdminConfig,
    getKycApplication,
    listAdminPackages,
    listCampaigns,
    listKycApplications,
    listCommissionQueue,
    listCommissionRules,
    listRiskReviewProfiles,
    listPayoutMethodQueue,
    listPayoutQueue,
    commissionsCsv,
    payoutsCsv,
    updateConfigDraft,
    updateCampaign,
};

const scheduleSupportSession = asyncHandler(async (req, res) => {
    const session = await supportService.scheduleSession({
        customer: req.user._id,
        entitlementId: req.body.entitlementId,
        scheduledAt: req.body.scheduledAt,
        req,
    });
    res.status(201).json(session);
});

const listSupportSessions = asyncHandler(async (req, res) => {
    res.json(await supportService.listSupportSessions({
        user: req.user._id,
        roles: req.user.roles || [],
        page: req.query.page,
        limit: req.query.limit,
    }));
});

const assignSupportSession = asyncHandler(async (req, res) => {
    res.json(await supportService.assignSupportSession({
        sessionId: req.params.sessionId,
        doctorId: req.body.doctorId,
        agentId: req.body.agentId,
        actor: req.user._id,
        req,
    }));
});

const updateSupportOutcome = asyncHandler(async (req, res) => {
    res.json(await supportService.updateSupportOutcome({
        sessionId: req.params.sessionId,
        actor: req.user._id,
        roles: req.user.roles || [],
        status: req.body.status,
        outcomeCode: req.body.outcomeCode,
        notes: req.body.notes,
        req,
    }));
});

const doctorNotes = asyncHandler(async (req, res) => {
    res.json(await supportService.getDoctorNotes({
        sessionId: req.params.sessionId,
        doctor: req.user._id,
        req,
    }));
});

module.exports = {
    ...reviewRewardAndCommissionLists,
    activity,
    activateConfig,
    assignUserRoles,
    assignSupportSession,
    consent,
    createConfigDraft,
    listConfigVersions,
    createLink,
    createPackageOrder,
    dashboard,
    doctorNotes,
    downloadKycDocument,
    enroll,
    getPackages,
    getProfile,
    getAdminConfig,
    getKycApplication,
    kycStatus,
    listSupportSessions,
    listNotifications,
    myPayouts,
    commissionsCsv,
    payoutsCsv,
    markNotificationRead,
    payoutMethod,
    portalSettings,
    profileStatus,
    referralPolicy,
    processPayout,
    recordVideoProgress,
    requestPayout,
    reviewCommission,
    reviewAffiliateRisk,
    reviewKyc,
    reviewPayout,
    reviewPayoutMethod,
    reviewVideoReward,
    scheduleSupportSession,
    setPayoutMethod,
    settlePayout,
    startVideo,
    submitKyc,
    trackReferral,
    updateProfile,
    updateConfigDraft,
    updateSupportOutcome,
};
