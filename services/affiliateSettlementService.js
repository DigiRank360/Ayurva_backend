const AffiliateProfile = require('../models/AffiliateProfile');
const AffiliatePackage = require('../models/AffiliatePackage');
const AffiliateRewardWindow = require('../models/AffiliateRewardWindow');
const AffiliateRenewalEvent = require('../models/AffiliateRenewalEvent');
const AffiliateSupportEntitlement = require('../models/AffiliateSupportEntitlement');
const AffiliateCommissionRule = require('../models/AffiliateCommissionRule');
const AffiliateCommission = require('../models/AffiliateCommission');
const AffiliateAttribution = require('../models/AffiliateAttribution');
const AffiliateConsent = require('../models/AffiliateConsent');
const Order = require('../models/Order');
const User = require('../models/User');
const { writeAudit } = require('./affiliateAuditService');
const { enqueueNotification } = require('./affiliateNotificationService');
const { assertAffiliateFeatureEnabled, getActiveConfig } = require('./affiliateConfigService');
const { getWalletSummary, postEntry, serializeAffiliateWallet, transferFunds } = require('./affiliateLedgerService');
const { fromMinorUnits, percentageOfMinorUnits, toMinorUnits } = require('../utils/affiliateMoney');
const { addCalendarDays, getIndiaDateKey } = require('../utils/affiliateTime');

function settlementError(message, statusCode = 409) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function getWindowStart(now, convention) {
    if (convention === 'ACTIVATION_INSTANT') return now;
    if (convention === 'IST_DAY_START') {
        const key = getIndiaDateKey(now);
        return new Date(`${key}T00:00:00+05:30`);
    }
    throw settlementError('Reward-window start convention is not configured.', 503);
}

async function hasCurrentConsent(user, purpose, version, session) {
    let query = AffiliateConsent.findOne({ user, purpose, version, granted: true }).sort({ occurredAt: -1 });
    if (session) query = query.session(session);
    return Boolean(await query);
}

async function activateAffiliateFromOrder(order, session, actor = null, req = null) {
    if (order.purchaseType !== 'AFFILIATE_PACKAGE' || !order.affiliatePackage) return null;
    const profile = await AffiliateProfile.findOne({ user: order.user }).session(session);
    if (!profile) return null;
    const config = await assertAffiliateFeatureEnabled(session);
    const packageRecord = await AffiliatePackage.findById(order.affiliatePackage).session(session);
    const user = await User.findById(order.user).session(session);
    if (!packageRecord || !user) throw settlementError('Paid affiliate package is missing its customer or package record.', 500);

    if (profile.activatedAt) return profile;
    profile.packageTier = packageRecord.code;
    profile.activePackage = packageRecord._id;
    if (!user.phoneVerifiedAt) {
        profile.status = 'PENDING_VERIFICATION';
        profile.statusReason = 'Verified mobile number is required.';
        await profile.save({ session });
        return profile;
    }
    profile.phoneVerifiedAt = user.phoneVerifiedAt;
    const requiredProfileFields = ['legalName', 'dateOfBirth', 'address', 'city', 'state', 'postalCode'];
    const hasCompleteProfile = requiredProfileFields.every((field) => Boolean(profile.profile?.[field]));
    const consentsAccepted = await hasCurrentConsent(user._id, 'AFFILIATE_AGREEMENT', config.affiliateAgreementVersion, session)
        && await hasCurrentConsent(user._id, 'TERMS', config.termsVersion, session)
        && await hasCurrentConsent(user._id, 'PRIVACY', config.privacyVersion, session);
    const eligible = hasCompleteProfile
        && Boolean(profile.agreementAcceptedAt)
        && consentsAccepted
        && profile.riskStatus === 'CLEAR'
        && ['PENDING_PAYMENT', 'PENDING_VERIFICATION', 'ACTIVE', 'REWARD_WINDOW_EXPIRED'].includes(profile.status);
    if (!eligible) {
        profile.status = profile.status === 'PENDING_PAYMENT' ? 'PENDING_VERIFICATION' : profile.status;
        profile.statusReason = !hasCompleteProfile
            ? 'Complete the required profile before activation.'
            : !consentsAccepted
                ? 'Current affiliate agreement and privacy consents are required.'
                : profile.riskStatus !== 'CLEAR'
                    ? 'Affiliate risk review is pending.'
                    : profile.statusReason;
        await profile.save({ session });
        return profile;
    }

    let rewardWindow = await AffiliateRewardWindow.findOne({ sourceOrder: order._id }).session(session);
    const firstActivation = !profile.activatedAt;
    const now = new Date();
    if (!rewardWindow && firstActivation) {
        const startsAt = getWindowStart(now, config.rewardWindowStartConvention);
        const endsAt = addCalendarDays(startsAt, packageRecord.rewardWindowDays);
        const sequence = (await AffiliateRewardWindow.countDocuments({ affiliate: profile._id }).session(session)) + 1;
        [rewardWindow] = await AffiliateRewardWindow.create([{
            affiliate: profile._id,
            package: packageRecord._id,
            sourceOrder: order._id,
            sequence,
            startsAt,
            endsAt,
            ruleSnapshot: {
                convention: config.rewardWindowStartConvention,
                durationDays: packageRecord.rewardWindowDays,
                packageVersion: packageRecord.version,
                configVersion: config.version,
            },
        }], { session });
        const previousStatus = profile.status;
        profile.activatedAt = startsAt;
        profile.status = 'ACTIVE';
        profile.statusReason = null;
        if (!user.roles.includes('affiliate_partner')) user.roles.push('affiliate_partner');
        await user.save({ session });
        await AffiliateSupportEntitlement.create([{
            affiliate: profile._id,
            customer: user._id,
            order: order._id,
            package: packageRecord._id,
            totalSessions: packageRecord.doctorSessionsPerMonth * packageRecord.durationMonths,
            startsAt,
            endsAt,
            ruleSnapshot: {
                sessionsPerMonth: packageRecord.doctorSessionsPerMonth,
                durationMonths: packageRecord.durationMonths,
                totalSessions: packageRecord.doctorSessionsPerMonth * packageRecord.durationMonths,
                packageVersion: packageRecord.version,
            },
        }], { session });
        await writeAudit({
            actor,
            action: 'AFFILIATE_ACTIVATED',
            resourceType: 'AffiliateProfile',
            resourceId: profile._id,
            before: { status: previousStatus },
            after: { status: 'ACTIVE', packageTier: packageRecord.code, rewardWindowId: rewardWindow._id },
            req,
            session,
        });
        await enqueueNotification({
            user: user._id,
            eventType: 'AFFILIATE_ACTIVATED',
            dedupeKey: `affiliate:${profile._id}:activated:${order._id}`,
            payload: { affiliateId: profile.affiliateId, packageTier: packageRecord.code },
        });
    }
    await profile.save({ session });
    return profile;
}

async function reviewAffiliateRisk({ profileId, decision, reason, actor, req }) {
    if (!['CLEAR', 'REVIEW', 'BLOCKED'].includes(decision)) {
        throw settlementError('Decision must be CLEAR, REVIEW, or BLOCKED.', 400);
    }
    if (typeof reason !== 'string' || reason.trim().length < 5) {
        throw settlementError('A clear risk-review reason is required.', 400);
    }
    return require('./affiliateLedgerService').runInTransaction(async (session) => {
        const profile = await AffiliateProfile.findById(profileId).session(session);
        if (!profile) throw settlementError('Affiliate profile not found.', 404);
        const before = { riskStatus: profile.riskStatus, status: profile.status };
        profile.riskStatus = decision;
        if (decision === 'BLOCKED') {
            profile.status = 'SUSPENDED';
            profile.statusReason = reason.trim();
        } else if (decision === 'REVIEW') {
            if (profile.activatedAt) profile.status = 'UNDER_REVIEW';
            profile.statusReason = reason.trim();
        } else {
            if (profile.activatedAt && ['SUSPENDED', 'UNDER_REVIEW'].includes(profile.status)) {
                profile.status = 'ACTIVE';
            } else if (!profile.activatedAt && ['SUSPENDED', 'UNDER_REVIEW'].includes(profile.status)) {
                profile.status = 'PENDING_VERIFICATION';
            }
            profile.statusReason = null;
        }
        await profile.save({ session });

        let reviewedProfile = profile;
        if (decision === 'CLEAR' && !profile.activatedAt) {
            const paidPackageOrder = await Order.findOne({
                user: profile.user,
                purchaseType: 'AFFILIATE_PACKAGE',
                paymentStatus: 'Paid',
                affiliatePackage: { $ne: null },
            }).sort({ createdAt: -1 }).session(session);
            if (paidPackageOrder) {
                await activateAffiliateFromOrder(paidPackageOrder, session, actor, req);
                reviewedProfile = await AffiliateProfile.findById(profile._id).session(session);
            }
        }
        await writeAudit({
            actor,
            action: 'AFFILIATE_RISK_REVIEWED',
            resourceType: 'AffiliateProfile',
            resourceId: profile._id,
            before,
            after: { riskStatus: reviewedProfile.riskStatus, status: reviewedProfile.status },
            reason: reason.trim(),
            req,
            session,
        });
        return reviewedProfile;
    });
}

async function renewAffiliateWindow({ order, attribution, packageRecord, config, session, actor = null, req = null }) {
    if (!attribution || config.renewalMode == null || config.qualifyingRenewalTier == null) return null;
    const affiliate = await AffiliateProfile.findById(attribution.affiliate).session(session);
    if (!affiliate || !['ACTIVE', 'REWARD_WINDOW_EXPIRED'].includes(affiliate.status)) return null;
    if (config.qualifyingRenewalTier === 'SAME_TIER' && affiliate.packageTier !== packageRecord.code) return null;
    const existing = await AffiliateRenewalEvent.findOne({ qualifyingOrder: order._id }).session(session);
    if (existing) return existing;
    const now = new Date();
    const previousWindow = await AffiliateRewardWindow.findOne({
        affiliate: affiliate._id,
        status: 'ACTIVE',
        endsAt: { $gt: now },
    }).sort({ endsAt: -1 }).session(session);
    const startsAt = previousWindow && config.renewalMode === 'EXTEND_ACTIVE'
        ? previousWindow.endsAt
        : getWindowStart(now, config.rewardWindowStartConvention);
    const endsAt = addCalendarDays(startsAt, packageRecord.rewardWindowDays);
    const sequence = (await AffiliateRewardWindow.countDocuments({ affiliate: affiliate._id }).session(session)) + 1;
    const [window] = await AffiliateRewardWindow.create([{
        affiliate: affiliate._id,
        package: packageRecord._id,
        sourceOrder: order._id,
        sequence,
        startsAt,
        endsAt,
        ruleSnapshot: {
            convention: config.rewardWindowStartConvention,
            durationDays: packageRecord.rewardWindowDays,
            renewalMode: config.renewalMode,
            qualifyingTier: config.qualifyingRenewalTier,
            packageVersion: packageRecord.version,
            configVersion: config.version,
        },
    }], { session });
    await AffiliateRenewalEvent.create([{
        affiliate: affiliate._id,
        qualifyingOrder: order._id,
        previousWindow: previousWindow?._id || null,
        newWindow: window._id,
        status: 'APPLIED',
        appliedAt: now,
    }], { session });
    await writeAudit({
        actor,
        action: 'AFFILIATE_REWARD_WINDOW_RENEWED',
        resourceType: 'AffiliateRewardWindow',
        resourceId: window._id,
        after: { sequence, startsAt, endsAt, qualifyingOrder: order._id },
        req,
        session,
    });
    await enqueueNotification({
        user: affiliate.user,
        eventType: 'REWARD_WINDOW_RENEWED',
        dedupeKey: `affiliate:${affiliate._id}:renewal:${order._id}`,
        payload: { startsAt, endsAt },
    });
    return window;
}

function getCommissionBaseMinor(order, packageRecord, rule, config) {
    if (rule.commissionBase !== config.commissionBasePolicy) {
        throw settlementError('Active commission rule does not match the approved commission-base policy.', 503);
    }
    if (rule.commissionBase === 'OFFER_PRICE') return toMinorUnits(order.packageSnapshot.offerPrice);
    if (rule.commissionBase === 'NET_COLLECTED') return toMinorUnits(String(order.itemsPrice));
    if (rule.commissionBase === 'CUSTOM') {
        throw settlementError('Custom commission base requires a finance-approved calculation adapter.', 503);
    }
    throw settlementError('Commission base is not configured.', 503);
}

async function createOrderCommission(order, attribution, packageRecord, config, session) {
    if (!attribution || order.purchaseType !== 'AFFILIATE_PACKAGE') return null;
    if (String(attribution.convertedOrder || '') !== String(order._id)) return null;
    const existing = await AffiliateCommission.findOne({ order: order._id }).session(session);
    if (existing) return existing;
    const affiliate = await AffiliateProfile.findById(attribution.affiliate).session(session);
    if (!affiliate || String(affiliate.user) === String(order.user)) return null;
    const now = new Date();
    const rule = await AffiliateCommissionRule.findOne({
        packageCode: packageRecord.code,
        active: true,
        effectiveFrom: { $lte: now },
        $or: [{ effectiveTo: null }, { effectiveTo: { $gt: now } }],
    }).sort({ version: -1 }).session(session);
    if (!rule) throw settlementError(`No active commission rule is configured for ${packageRecord.code}.`, 503);
    const baseMinor = getCommissionBaseMinor(order, packageRecord, rule, config);
    const commissionMinor = percentageOfMinorUnits(baseMinor, rule.ratePercent.toString());
    const status = affiliate.status === 'ACTIVE' && affiliate.riskStatus === 'CLEAR' ? 'PENDING' : 'ON_HOLD';
    const [commission] = await AffiliateCommission.create([{
        affiliate: affiliate._id,
        order: order._id,
        attribution: attribution._id,
        rule: rule._id,
        status,
        currency: 'INR',
        baseAmount: fromMinorUnits(baseMinor),
        ratePercent: rule.ratePercent,
        commissionAmount: fromMinorUnits(commissionMinor),
        packageSnapshot: order.packageSnapshot,
        ruleSnapshot: {
            version: rule.version,
            ratePercent: rule.ratePercent.toString(),
            commissionBase: rule.commissionBase,
            settlementDays: rule.settlementDays,
        },
    }], { session });
    await postEntry({
        affiliate: affiliate._id,
        idempotencyKey: `commission:${commission._id}:pending`,
        sourceType: 'COMMISSION',
        sourceId: commission._id,
        bucket: status === 'PENDING' ? 'PENDING' : 'ON_HOLD',
        direction: 'CREDIT',
        amountMinor: commissionMinor,
        description: status === 'PENDING' ? 'Pending direct package-sale commission.' : 'Commission held for affiliate review.',
        session,
    });
    await enqueueNotification({
        user: affiliate.user,
        eventType: 'DIRECT_SALE_ATTRIBUTED',
        dedupeKey: `affiliate:${affiliate._id}:commission:${commission._id}:created`,
        payload: { commissionId: commission._id, status, amount: commission.commissionAmount.toString() },
    });
    return commission;
}

async function processPaidAffiliateOrder(orderId, session, actor = null, req = null) {
    const order = await Order.findById(orderId).session(session);
    if (!order || order.paymentStatus !== 'Paid') throw settlementError('Only a verified paid order can be settled.');
    if (order.purchaseType !== 'AFFILIATE_PACKAGE' || !order.affiliatePackage) return null;
    const [config, packageRecord] = await Promise.all([
        assertAffiliateFeatureEnabled(session),
        AffiliatePackage.findById(order.affiliatePackage).session(session),
    ]);
    if (!packageRecord) throw settlementError('The purchased affiliate package could not be found.', 500);

    await activateAffiliateFromOrder(order, session, actor, req);
    let attribution = null;
    if (order.affiliateAttribution) {
        attribution = await AffiliateAttribution.findById(order.affiliateAttribution).session(session);
        if (attribution && String(attribution.convertedOrder || order._id) === String(order._id)) {
            attribution.convertedOrder = order._id;
            attribution.convertedAt = order.paymentResult?.paidAt || new Date();
            attribution.status = 'CONVERTED';
            await attribution.save({ session });
        }
    }
    await renewAffiliateWindow({ order, attribution, packageRecord, config, session, actor, req });
    return createOrderCommission(order, attribution, packageRecord, config, session);
}

async function reviewVideoReward({ eventId, decision, reason, actor, req }) {
    if (!['APPROVED', 'REJECTED'].includes(decision)) throw settlementError('Decision must be APPROVED or REJECTED.', 400);
    if (decision === 'REJECTED' && (!reason || reason.trim().length < 5)) {
        throw settlementError('Provide a clear reason for rejecting this reward.', 400);
    }
    return require('./affiliateLedgerService').runInTransaction(async (session) => {
        const event = await require('../models/AffiliateReferralEvent').findOneAndUpdate(
            { _id: eventId, eventType: 'REWARD_QUALIFIED', status: 'PENDING_REVIEW' },
            { $set: {
                status: decision,
                reasonCode: decision === 'REJECTED' ? 'ADMIN_REJECTED' : null,
                reviewReason: decision === 'REJECTED' ? reason.trim() : null,
            } },
            { new: true, session },
        );
        if (!event) throw settlementError('Pending video reward was not found or was already reviewed.', 404);
        await serializeAffiliateWallet(event.affiliate, session);
        const amountMinor = toMinorUnits(event.rewardAmount);
        if (decision === 'APPROVED') {
            await transferFunds({
                affiliate: event.affiliate,
                sourceType: 'APPROVAL',
                sourceId: event._id,
                fromBucket: 'PENDING',
                toBucket: 'AVAILABLE',
                amountMinor,
                idempotencyKey: `video:${event._id}:approval`,
                description: 'Video reward approved.',
                createdBy: actor,
                session,
            });
        } else {
            await transferFunds({
                affiliate: event.affiliate,
                sourceType: 'REVERSAL',
                sourceId: event._id,
                fromBucket: 'PENDING',
                toBucket: 'REVERSED',
                amountMinor,
                idempotencyKey: `video:${event._id}:rejection`,
                description: 'Pending video reward rejected.',
                createdBy: actor,
                session,
            });
        }
        if (event.dailyKey) {
            const config = await assertAffiliateFeatureEnabled(session);
            if (config.dailyCapMode === 'RESERVE_ON_RECEIPT') {
                await AffiliateDailyCap.updateOne(
                    { affiliate: event.affiliate, indiaDateKey: event.dailyKey, reservedCount: { $gt: 0 } },
                    { $inc: decision === 'APPROVED' ? { reservedCount: -1, approvedCount: 1 } : { reservedCount: -1 } },
                    { session },
                );
            } else if (decision === 'APPROVED') {
                const profile = await AffiliateProfile.findById(event.affiliate).populate('activePackage').session(session);
                const cap = await AffiliateDailyCap.findOneAndUpdate({
                    affiliate: event.affiliate,
                    indiaDateKey: event.dailyKey,
                    $expr: { $lt: ['$approvedCount', profile.activePackage.dailyReferralCap] },
                }, { $inc: { approvedCount: 1 }, $set: { updatedAt: new Date() } }, { new: true, session });
                if (!cap) throw settlementError('Daily reward cap has been reached.');
            }
        }
        await writeAudit({
            actor,
            action: `VIDEO_REWARD_${decision}`,
            resourceType: 'AffiliateReferralEvent',
            resourceId: event._id,
            reason,
            after: { status: decision },
            req,
            session,
        });
        await enqueueNotification({
            user: (await AffiliateProfile.findById(event.affiliate).session(session)).user,
            eventType: decision === 'APPROVED' ? 'REWARD_APPROVED' : 'REWARD_REJECTED',
            dedupeKey: `video:${event._id}:review:${decision}`,
            payload: { eventId: event._id, reason: reason || null },
        });
        return event;
    });
}

async function reviewCommission({ commissionId, decision, reason, actor, req }) {
    const transitions = { APPROVED: ['PENDING'], ON_HOLD: ['PENDING', 'APPROVED'], PAYABLE: ['APPROVED'] };
    if (!transitions[decision]) throw settlementError('Unsupported commission decision.', 400);
    if (['ON_HOLD'].includes(decision) && (!reason || reason.trim().length < 5)) {
        throw settlementError('Provide a clear reason for placing a commission on hold.', 400);
    }
    return require('./affiliateLedgerService').runInTransaction(async (session) => {
        const commission = await AffiliateCommission.findById(commissionId).session(session);
        if (!commission || !transitions[decision].includes(commission.status)) {
            throw settlementError('Commission does not allow this status transition.', 409);
        }
        if (decision === 'APPROVED') {
            const order = await Order.findById(commission.order).session(session);
            if (!order || order.paymentStatus !== 'Paid' || order.orderStatus !== 'Delivered'
                || !order.isDelivered || !order.deliveredAt) {
                throw settlementError('Commission can only be approved after a paid order is delivered.', 409);
            }
            const paidAt = order.paymentResult?.paidAt || order.createdAt;
            const settlementStart = new Date(Math.max(new Date(order.deliveredAt).getTime(), new Date(paidAt).getTime()));
            const settlementAt = new Date(settlementStart.getTime() + commission.ruleSnapshot.settlementDays * 86400000);
            if (new Date() < settlementAt) {
                throw settlementError('Commission is still within its post-delivery settlement period.', 409);
            }
        }
        const previous = commission.status;
        const amountMinor = toMinorUnits(commission.commissionAmount);
        await serializeAffiliateWallet(commission.affiliate, session);
        if (decision === 'APPROVED') {
            await transferFunds({
                affiliate: commission.affiliate,
                sourceType: 'APPROVAL',
                sourceId: commission._id,
                fromBucket: 'PENDING',
                toBucket: 'APPROVED',
                amountMinor,
                idempotencyKey: `commission:${commission._id}:approval`,
                description: 'Commission approved after settlement period.',
                createdBy: actor,
                session,
            });
            commission.approvedAt = new Date();
        } else if (decision === 'PAYABLE') {
            const config = await getActiveConfig(session);
            if (!config) throw settlementError('An active affiliate payout policy is required.', 503);
            const wallet = await getWalletSummary(commission.affiliate, session);
            const minimum = toMinorUnits(config.payoutMinimum);
            if (wallet.available + wallet.approved < minimum) {
                throw settlementError('Affiliate available balance has not reached the configured payout minimum.');
            }
            await transferFunds({
                affiliate: commission.affiliate,
                sourceType: 'APPROVAL',
                sourceId: commission._id,
                fromBucket: 'APPROVED',
                toBucket: 'AVAILABLE',
                amountMinor,
                idempotencyKey: `commission:${commission._id}:payable`,
                description: 'Approved commission released as payable.',
                createdBy: actor,
                session,
            });
            commission.payableAt = new Date();
        } else if (decision === 'ON_HOLD') {
            const fromBucket = previous === 'PENDING' ? 'PENDING' : 'APPROVED';
            await transferFunds({
                affiliate: commission.affiliate,
                sourceType: 'HOLD',
                sourceId: commission._id,
                fromBucket,
                toBucket: 'ON_HOLD',
                amountMinor,
                idempotencyKey: `commission:${commission._id}:hold`,
                description: 'Commission placed on hold for review.',
                createdBy: actor,
                session,
            });
        }
        commission.status = decision;
        commission.statusReason = reason?.trim() || null;
        await commission.save({ session });
        await writeAudit({
            actor,
            action: `COMMISSION_${decision}`,
            resourceType: 'AffiliateCommission',
            resourceId: commission._id,
            reason,
            before: { status: previous },
            after: { status: commission.status },
            req,
            session,
        });
        await enqueueNotification({
            user: (await AffiliateProfile.findById(commission.affiliate).session(session)).user,
            eventType: `COMMISSION_${decision}`,
            dedupeKey: `commission:${commission._id}:${decision}`,
            payload: { commissionId: commission._id, status: decision },
        });
        return commission;
    });
}

module.exports = {
    activateAffiliateFromOrder,
    createOrderCommission,
    processPaidAffiliateOrder,
    renewAffiliateWindow,
    reviewCommission,
    reviewAffiliateRisk,
    reviewVideoReward,
};
