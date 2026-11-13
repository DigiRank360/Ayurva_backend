const crypto = require('crypto');
const AffiliateProfile = require('../models/AffiliateProfile');
const AffiliatePackage = require('../models/AffiliatePackage');
const AffiliateReferralLink = require('../models/AffiliateReferralLink');
const AffiliateReferralEvent = require('../models/AffiliateReferralEvent');
const AffiliateCommission = require('../models/AffiliateCommission');
const AffiliatePayoutRequest = require('../models/AffiliatePayoutRequest');
const AffiliateRewardWindow = require('../models/AffiliateRewardWindow');
const AffiliateSupportEntitlement = require('../models/AffiliateSupportEntitlement');
const AffiliateSupportSession = require('../models/AffiliateSupportSession');
const AffiliateConsent = require('../models/AffiliateConsent');
const User = require('../models/User');
const { writeAudit } = require('./affiliateAuditService');
const { assertAffiliateFeatureEnabled, getActiveConfig } = require('./affiliateConfigService');
const { runInTransaction, getWalletSummary } = require('./affiliateLedgerService');

function affiliateError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function publicCode(prefix, bytes = 8) {
    return `${prefix}-${crypto.randomBytes(bytes).toString('hex').toUpperCase()}`;
}

async function enrollAffiliate(userId, input, req) {
    const config = await assertAffiliateFeatureEnabled();
    const user = await User.findById(userId);
    if (!user) throw affiliateError('Customer account not found.', 404);
    if (!user.phoneVerifiedAt) throw affiliateError('Verify your mobile number before affiliate enrollment.', 403);
    if (user.accountStatus && user.accountStatus !== 'ACTIVE') throw affiliateError('This account is not active.', 403);
    if (await AffiliateProfile.exists({ user: userId })) throw affiliateError('An affiliate profile already exists for this customer.', 409);

    const { legalName, dateOfBirth, address, city, state, postalCode } = input.profile || {};
    if (!legalName?.trim() || !dateOfBirth || !address?.trim() || !city?.trim() || !state?.trim() || !postalCode?.trim()) {
        throw affiliateError('Complete the required legal name, date of birth and address fields.');
    }
    if (input.affiliateAgreementVersion !== config.affiliateAgreementVersion
        || input.termsVersion !== config.termsVersion
        || input.privacyVersion !== config.privacyVersion) {
        throw affiliateError('Review and accept the current affiliate agreement, terms and privacy notice.', 409);
    }

    return runInTransaction(async (session) => {
        const [profile] = await AffiliateProfile.create([{
            user: userId,
            affiliateId: publicCode('AP'),
            referralCode: publicCode('REF'),
            status: 'PENDING_PAYMENT',
            profile: { legalName: legalName.trim(), dateOfBirth, address: address.trim(), city: city.trim(), state: state.trim(), postalCode: postalCode.trim() },
            phoneVerifiedAt: user.phoneVerifiedAt,
            agreementAcceptedAt: new Date(),
            riskStatus: 'PENDING',
        }], { session });

        await AffiliateConsent.create([
            { user: userId, affiliate: profile._id, purpose: 'AFFILIATE_AGREEMENT', version: config.affiliateAgreementVersion, granted: true, source: 'WEB' },
            { user: userId, affiliate: profile._id, purpose: 'TERMS', version: config.termsVersion, granted: true, source: 'WEB' },
            { user: userId, affiliate: profile._id, purpose: 'PRIVACY', version: config.privacyVersion, granted: true, source: 'WEB' },
        ], { session });
        await writeAudit({
            actor: userId,
            action: 'AFFILIATE_ENROLLED',
            resourceType: 'AffiliateProfile',
            resourceId: profile._id,
            after: { status: profile.status, affiliateId: profile.affiliateId },
            req,
            session,
        });
        return profile;
    });
}

async function getAffiliateForUser(userId) {
    const profile = await AffiliateProfile.findOne({ user: userId })
        .populate('activePackage', 'code name version durationMonths');
    if (!profile) throw affiliateError('Affiliate profile not found.', 404);
    return profile;
}

async function updateAffiliateProfile(userId, input, req) {
    const profile = await AffiliateProfile.findOne({ user: userId });
    if (!profile) throw affiliateError('Affiliate profile not found.', 404);
    if (['TERMINATED', 'SUSPENDED'].includes(profile.status)) throw affiliateError('This affiliate profile cannot be edited.', 409);
    const fields = ['legalName', 'dateOfBirth', 'address', 'city', 'state', 'postalCode'];
    const before = {};
    const after = {};
    for (const field of fields) {
        if (input[field] !== undefined) {
            const value = typeof input[field] === 'string' ? input[field].trim() : input[field];
            before[field] = profile.profile?.[field] || null;
            after[field] = value;
            profile.set(`profile.${field}`, value);
        }
    }
    if (!Object.keys(after).length) throw affiliateError('No supported profile fields were provided.');
    await profile.save();
    await writeAudit({
        actor: userId,
        action: 'AFFILIATE_PROFILE_UPDATED',
        resourceType: 'AffiliateProfile',
        resourceId: profile._id,
        before,
        after,
        req,
    });
    return profile;
}

async function listActivePackages() {
    const now = new Date();
    return AffiliatePackage.find({
        active: true,
        effectiveFrom: { $lte: now },
        $or: [{ effectiveTo: null }, { effectiveTo: { $gt: now } }],
    }).sort({ code: 1, version: -1 }).lean();
}

async function createReferralLink(userId, { kind, packageId, campaignId }, req) {
    await assertAffiliateFeatureEnabled();
    const affiliate = await AffiliateProfile.findOne({ user: userId, status: 'ACTIVE' });
    if (!affiliate) throw affiliateError('Only active affiliates can create referral links.', 403);
    const linkKind = String(kind || 'GENERAL').toUpperCase();
    if (!['GENERAL', 'VIDEO', 'PACKAGE', 'CAMPAIGN'].includes(linkKind)) throw affiliateError('Invalid referral link type.');

    let packageRecord = null;
    let campaign = null;
    if (linkKind === 'PACKAGE') {
        packageRecord = packageId
            ? await AffiliatePackage.findOne({ _id: packageId, active: true })
            : null;
        if (!packageRecord) throw affiliateError('Select an active package for this referral link.');
    }
    if (linkKind === 'CAMPAIGN' || linkKind === 'VIDEO') {
        const AffiliateCampaign = require('../models/AffiliateCampaign');
        campaign = campaignId
            ? await AffiliateCampaign.findOne({ _id: campaignId, status: 'ACTIVE', startsAt: { $lte: new Date() }, $or: [{ endsAt: null }, { endsAt: { $gt: new Date() } }] })
            : null;
        if (!campaign) throw affiliateError('Select an active campaign for this referral link.');
    }

    const link = await AffiliateReferralLink.create({
        affiliate: affiliate._id,
        token: crypto.randomBytes(24).toString('base64url'),
        kind: linkKind,
        package: packageRecord?._id || null,
        campaign: campaign?._id || null,
        createdBy: userId,
    });
    await writeAudit({
        actor: userId,
        action: 'AFFILIATE_REFERRAL_LINK_CREATED',
        resourceType: 'AffiliateReferralLink',
        resourceId: link._id,
        after: { kind: link.kind, package: link.package, campaign: link.campaign },
        req,
    });
    return link;
}

async function getAffiliateDashboard(userId) {
    const profile = await AffiliateProfile.findOne({ user: userId });
    if (!profile) throw affiliateError('Affiliate profile not found.', 404);
    const [window, counts, commissions, payouts, entitlements, wallet] = await Promise.all([
        AffiliateRewardWindow.findOne({ affiliate: profile._id, status: 'ACTIVE' }).sort({ endsAt: -1 }).lean(),
        AffiliateReferralEvent.aggregate([
            { $match: { affiliate: profile._id } },
            { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        AffiliateCommission.find({ affiliate: profile._id }).sort({ createdAt: -1 }).limit(50).lean(),
        AffiliatePayoutRequest.find({ affiliate: profile._id }).sort({ createdAt: -1 }).limit(50).lean(),
        AffiliateSupportEntitlement.find({ affiliate: profile._id, status: 'ACTIVE' }).sort({ endsAt: 1 }).lean(),
        getWalletSummary(profile._id),
    ]);
    const referralLinks = await AffiliateReferralLink.find({ affiliate: profile._id, active: true })
        .populate('package', 'code name version')
        .populate('campaign', 'name slug')
        .sort({ createdAt: -1 })
        .lean();
    return {
        affiliate: {
            affiliateId: profile.affiliateId,
            status: profile.status,
            packageTier: profile.packageTier,
            activatedAt: profile.activatedAt,
            riskStatus: profile.riskStatus,
        },
        rewardWindow: window,
        eventCounts: Object.fromEntries(counts.map(({ _id, count }) => [_id, count])),
        earnings: wallet,
        referralLinks,
        commissions,
        payouts,
        supportEntitlements: entitlements,
    };
}

async function listAffiliateActivity(userId, { page = 1, limit = 25 } = {}) {
    const profile = await AffiliateProfile.findOne({ user: userId }).select('_id');
    if (!profile) throw affiliateError('Affiliate profile not found.', 404);
    const safePage = Math.max(1, Math.min(Number.parseInt(page, 10) || 1, 100000));
    const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 25, 100));
    const filter = { affiliate: profile._id };
    const [events, total] = await Promise.all([
        AffiliateReferralEvent.find(filter).select('-visitorKey -videoSessionHash').sort({ eventAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
        AffiliateReferralEvent.countDocuments(filter),
    ]);
    return { events, page: safePage, limit: safeLimit, total };
}

async function recordConsent(userId, { purpose, version, granted }, req) {
    const config = await getActiveConfig();
    const affiliate = await AffiliateProfile.findOne({ user: userId }).select('_id');
    const allowed = {
        REFERRAL_TRACKING: config?.referralConsentVersion,
        DOCTOR_SUPPORT: config?.supportConsentVersion,
        MARKETING: config?.privacyVersion,
        PAYOUT_KYC: config?.kycConsentVersion,
    };
    if (!Object.hasOwn(allowed, purpose) || !allowed[purpose] || version !== allowed[purpose]) {
        throw affiliateError('Consent purpose or version is invalid.', 400);
    }
    const consent = await AffiliateConsent.create({
        user: userId,
        affiliate: affiliate?._id || null,
        purpose,
        version,
        granted: Boolean(granted),
        source: 'WEB',
    });
    await writeAudit({
        actor: userId,
        action: granted ? 'CONSENT_GRANTED' : 'CONSENT_WITHDRAWN',
        resourceType: 'AffiliateConsent',
        resourceId: consent._id,
        after: { purpose, version, granted: Boolean(granted) },
        req,
    });
    return consent;
}

async function getProfileStatus(userId) {
    const [profile, user] = await Promise.all([
        AffiliateProfile.findOne({ user: userId }).populate('activePackage', 'code name version'),
        User.findById(userId).select('phoneVerifiedAt accountStatus'),
    ]);
    return { profile, phoneVerifiedAt: user?.phoneVerifiedAt || null, accountStatus: user?.accountStatus || 'ACTIVE' };
}

module.exports = {
    affiliateError,
    createReferralLink,
    enrollAffiliate,
    getAffiliateDashboard,
    getAffiliateForUser,
    getProfileStatus,
    listActivePackages,
    listAffiliateActivity,
    publicCode,
    recordConsent,
    updateAffiliateProfile,
};
