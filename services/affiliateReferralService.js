const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const AffiliateProfile = require('../models/AffiliateProfile');
const AffiliateReferralLink = require('../models/AffiliateReferralLink');
const AffiliateReferralEvent = require('../models/AffiliateReferralEvent');
const AffiliateAttribution = require('../models/AffiliateAttribution');
const AffiliateCampaign = require('../models/AffiliateCampaign');
const AffiliateRewardWindow = require('../models/AffiliateRewardWindow');
const AffiliateVisitorRewardLock = require('../models/AffiliateVisitorRewardLock');
const AffiliateDailyCap = require('../models/AffiliateDailyCap');
const AffiliateConsent = require('../models/AffiliateConsent');
const { writeAudit } = require('./affiliateAuditService');
const { assertAffiliateFeatureEnabled } = require('./affiliateConfigService');
const { postEntry, runInTransaction } = require('./affiliateLedgerService');
const { getIndiaDateKey } = require('../utils/affiliateTime');

const ATTRIBUTION_COOKIE = 'affiliate_attribution';
const VISITOR_COOKIE = 'affiliate_visitor';
const CONSENT_COOKIE = 'affiliate_tracking_consent';

function referralError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function getVisitorHashSecret() {
    const secret = process.env.AFFILIATE_VISITOR_HASH_SECRET || process.env.JWT_SECRET;
    if (!secret) throw referralError('Referral tracking is not configured.', 503);
    return secret;
}

function hashVisitorId(visitorId) {
    return crypto.createHmac('sha256', getVisitorHashSecret()).update(visitorId).digest('hex');
}

function cookieOptions(maxAge) {
    const production = process.env.NODE_ENV === 'production';
    const options = {
        httpOnly: true,
        secure: production,
        sameSite: production ? 'none' : 'lax',
        path: '/api/affiliate',
        maxAge,
    };
    if (process.env.AFFILIATE_COOKIE_DOMAIN) options.domain = process.env.AFFILIATE_COOKIE_DOMAIN;
    return options;
}

function issueVisitorId(req, res, days) {
    try {
        const decoded = jwt.verify(req.cookies?.[VISITOR_COOKIE], process.env.JWT_SECRET);
        if (decoded.purpose === 'affiliate-visitor') return decoded.id;
    } catch (error) {
        if (req.cookies?.[VISITOR_COOKIE]) {
            res.clearCookie(VISITOR_COOKIE, cookieOptions(0));
        }
    }
    const id = crypto.randomBytes(24).toString('base64url');
    const token = jwt.sign({ id, purpose: 'affiliate-visitor' }, process.env.JWT_SECRET, { expiresIn: `${days}d` });
    res.cookie(VISITOR_COOKIE, token, cookieOptions(days * 24 * 60 * 60 * 1000));
    return id;
}

function setAttributionCookie(res, referral, affiliate, config) {
    const token = jwt.sign({
        affiliate: affiliate._id.toString(),
        referral: referral._id.toString(),
        policyVersion: String(config.version),
        purpose: 'affiliate-attribution',
    }, process.env.JWT_SECRET, { expiresIn: `${config.attributionWindowDays}d` });
    res.cookie(ATTRIBUTION_COOKIE, token, cookieOptions(config.attributionWindowDays * 24 * 60 * 60 * 1000));
}

async function trackReferralVisit(req, res, token) {
    const config = await assertAffiliateFeatureEnabled();
    const referral = await AffiliateReferralLink.findOne({ token, active: true });
    if (!referral) throw referralError('Referral link not found.', 404);
    const affiliate = await AffiliateProfile.findOne({ _id: referral.affiliate, status: 'ACTIVE' });
    if (!affiliate) throw referralError('This referral link is no longer active.', 410);

    const hasConsent = req.body?.consentGranted === true
        && req.body?.consentVersion === config.referralConsentVersion;
    if (!hasConsent) {
        return { tracked: false, message: 'Referral tracking requires current consent.' };
    }
    if (req.user && String(req.user._id) === String(affiliate.user)) {
        await AffiliateReferralEvent.create({
            referral: referral._id,
            affiliate: affiliate._id,
            campaign: referral.campaign,
            visitorKey: hashVisitorId(String(req.user._id)),
            visitorUser: req.user._id,
            eventType: 'CLICK',
            status: config.selfReferralPolicy === 'HOLD_RISK' ? 'PENDING_REVIEW' : 'SELF_REFERRAL',
            reasonCode: 'OWN_ACCOUNT',
        });
        return { tracked: false, message: 'Self-referrals are not eligible.' };
    }

    const visitorId = issueVisitorId(req, res, config.visitorUniquenessDays);
    const consentToken = jwt.sign({
        purpose: 'affiliate-tracking-consent',
        version: config.referralConsentVersion,
    }, process.env.JWT_SECRET, { expiresIn: `${config.visitorUniquenessDays}d` });
    res.cookie(CONSENT_COOKIE, consentToken, cookieOptions(config.visitorUniquenessDays * 86400000));
    const visitorKey = hashVisitorId(req.user ? `user:${req.user._id}` : visitorId);
    const now = new Date();
    const event = await AffiliateReferralEvent.create({
        referral: referral._id,
        affiliate: affiliate._id,
        campaign: referral.campaign,
        visitorKey,
        visitorUser: req.user?._id || null,
        eventType: 'CLICK',
        eventAt: now,
        status: 'RECORDED',
    });
    setAttributionCookie(res, referral, affiliate, config);
    if (req.user) {
        await AffiliateConsent.create({
            user: req.user._id,
            affiliate: null,
            purpose: 'REFERRAL_TRACKING',
            version: config.referralConsentVersion,
            granted: true,
            source: 'WEB',
        });
        await captureCustomerAttribution({
            customer: req.user._id,
            affiliate,
            referral,
            eventAt: now,
            config,
        });
    }
    await writeAudit({
        actor: req.user?._id,
        action: 'AFFILIATE_REFERRAL_VISIT',
        resourceType: 'AffiliateReferralEvent',
        resourceId: event._id,
        after: { eventType: 'CLICK', affiliate: affiliate._id },
        req,
    });
    return { tracked: true, eventId: event._id, campaignId: referral.campaign };
}

async function captureCustomerAttribution({ customer, affiliate, referral, eventAt, config, session }) {
    const current = await AffiliateAttribution.findOne({ customer, status: 'ACTIVE' }).session(session || null);
    if (current && new Date(current.expiresAt) > eventAt) {
        if (config.attributionMode === 'LAST_CLICK') {
            current.affiliate = affiliate._id;
            current.referral = referral._id;
            current.lastTouchAt = eventAt;
            current.expiresAt = new Date(eventAt.getTime() + config.attributionWindowDays * 86400000);
            current.policyVersion = String(config.version);
            await current.save({ session });
            return current;
        }
        if (config.attributionMode === 'FIRST_CLICK' || config.attributionMode === 'LOCKED') {
            current.lastTouchAt = eventAt;
            await current.save({ session });
            return current;
        }
    }
    if (current) {
        current.status = 'EXPIRED';
        await current.save({ session });
    }
    return AffiliateAttribution.create([{
        customer,
        affiliate: affiliate._id,
        referral: referral._id,
        firstTouchAt: eventAt,
        lastTouchAt: eventAt,
        expiresAt: new Date(eventAt.getTime() + config.attributionWindowDays * 86400000),
        policyVersion: String(config.version),
        status: 'ACTIVE',
    }], session ? { session } : {}).then(([attribution]) => attribution);
}

async function resolveOrderAttribution(req, customer, session) {
    const token = req.cookies?.[ATTRIBUTION_COOKIE];
    if (!token) return null;
    let claims;
    try {
        claims = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') return null;
        throw error;
    }
    if (claims.purpose !== 'affiliate-attribution') return null;
    const [config, referral, affiliate] = await Promise.all([
        assertAffiliateFeatureEnabled(session),
        AffiliateReferralLink.findOne({ _id: claims.referral, active: true }).session(session || null),
        AffiliateProfile.findOne({ _id: claims.affiliate, status: 'ACTIVE' }).session(session || null),
    ]);
    if (!referral || !affiliate || String(referral.affiliate) !== String(affiliate._id)) return null;
    if (String(affiliate.user) === String(customer)) return null;
    const lastClick = new Date(claims.iat * 1000);
    if (lastClick.getTime() + config.attributionWindowDays * 86400000 <= Date.now()) return null;
    const attribution = await captureCustomerAttribution({
        customer,
        affiliate,
        referral,
        eventAt: lastClick,
        config,
        session,
    });
    if (attribution.convertedOrder) return null;
    return attribution;
}

async function startVideoSession(userId, token, req) {
    const config = await assertAffiliateFeatureEnabled();
    const hasConsent = req.body?.consentGranted === true
        && req.body?.consentVersion === config.referralConsentVersion;
    if (!hasConsent) throw referralError('Current referral-tracking consent is required.', 403);
    const referral = await AffiliateReferralLink.findOne({ token, active: true });
    if (!referral || !['VIDEO', 'CAMPAIGN'].includes(referral.kind) || !referral.campaign) {
        throw referralError('Video referral link not found.', 404);
    }
    const [affiliate, campaign, window] = await Promise.all([
        AffiliateProfile.findOne({ _id: referral.affiliate, status: 'ACTIVE' }),
        AffiliateCampaign.findOne({ _id: referral.campaign, status: 'ACTIVE', startsAt: { $lte: new Date() }, $or: [{ endsAt: null }, { endsAt: { $gt: new Date() } }] }),
        AffiliateRewardWindow.findOne({ affiliate: referral.affiliate, status: 'ACTIVE', startsAt: { $lte: new Date() }, endsAt: { $gt: new Date() } }).sort({ endsAt: -1 }),
    ]);
    if (!affiliate || !campaign || !window) throw referralError('Video rewards are not available for this affiliate or campaign.', 409);
    const isSelfReferral = Boolean(userId && String(userId) === String(affiliate.user));
    if (isSelfReferral && config.selfReferralPolicy === 'REJECT_OWN_ACCOUNT') {
        throw referralError('Self-referrals are not eligible.', 403);
    }
    if (!campaign.videoDurationSeconds) throw referralError('This campaign has no approved video duration.', 503);

    const visitorId = issueVisitorId(req, req.res, config.visitorUniquenessDays);
    const visitorKey = hashVisitorId(userId ? `user:${userId}` : visitorId);
    const event = await AffiliateReferralEvent.create({
        referral: referral._id,
        affiliate: affiliate._id,
        campaign: campaign._id,
        visitorKey,
        visitorUser: userId || null,
        eventType: 'VIDEO_START',
        eventAt: new Date(),
        status: isSelfReferral ? 'PENDING_REVIEW' : 'RECORDED',
        reasonCode: isSelfReferral ? 'OWN_ACCOUNT' : null,
    });
    const sessionToken = jwt.sign({
        event: event._id.toString(),
        affiliate: affiliate._id.toString(),
        purpose: 'affiliate-video-session',
    }, process.env.JWT_SECRET, { expiresIn: `${Math.min(config.attributionWindowDays, 2)}d` });
    event.videoSessionHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
    await event.save();
    return { sessionToken, expiresInSeconds: Math.min(config.attributionWindowDays, 2) * 86400 };
}

function nextVideoMilestone(milestone) {
    const sequence = ['VIDEO_25', 'VIDEO_50', 'VIDEO_75', 'VIDEO_COMPLETE'];
    const index = sequence.indexOf(milestone);
    if (index < 0) throw referralError('Invalid video milestone.');
    return { sequence, index };
}

async function recordVideoProgress(userId, sessionToken, milestone) {
    const config = await assertAffiliateFeatureEnabled();
    let claims;
    try {
        claims = jwt.verify(sessionToken, process.env.JWT_SECRET);
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') throw referralError('Video session is invalid or expired.', 401);
        throw error;
    }
    if (claims.purpose !== 'affiliate-video-session') throw referralError('Invalid video session.', 401);
    const { sequence, index } = nextVideoMilestone(milestone);
    const start = await AffiliateReferralEvent.findOne({ _id: claims.event, eventType: 'VIDEO_START' })
        .select('+visitorKey +videoSessionHash');
    if (!start || !start.videoSessionHash || String(start.affiliate) !== claims.affiliate) {
        throw referralError('Video session was not found.', 404);
    }
    if (userId && start.visitorUser && String(start.visitorUser) !== String(userId)) {
        throw referralError('Video session belongs to another account.', 403);
    }
    const priorEvents = await AffiliateReferralEvent.find({
        videoSessionHash: start.videoSessionHash,
        eventType: { $in: sequence.slice(0, index) },
    }).select('eventType');
    if (index > 0 && priorEvents.length < index) throw referralError('Video milestones must be recorded in order.', 409);
    let existingMilestone = await AffiliateReferralEvent.findOne({
        videoSessionHash: start.videoSessionHash,
        eventType: milestone,
    });
    if (existingMilestone && milestone !== 'VIDEO_COMPLETE') return { accepted: true, duplicate: true, milestone };
    if (milestone === 'VIDEO_COMPLETE') {
        const existingReward = await AffiliateReferralEvent.findOne({
            videoSessionHash: `${start.videoSessionHash}:reward`,
            eventType: 'REWARD_QUALIFIED',
        });
        if (existingReward) return { accepted: true, duplicate: true, qualified: true, status: existingReward.status, eventId: existingReward._id };
    }

    const campaign = await AffiliateCampaign.findById(start.campaign);
    if (!campaign) throw referralError('Campaign not found.', 404);
    const elapsedSeconds = Math.floor((Date.now() - start.eventAt.getTime()) / 1000);
    const requiredElapsed = Math.ceil(campaign.videoDurationSeconds * (index + 1) / 4);
    if (elapsedSeconds < requiredElapsed) {
        throw referralError('Video progress does not meet the server-side timing requirement.', 400);
    }
    let event = existingMilestone;
    if (!event) {
        try {
            [event] = await AffiliateReferralEvent.create([{
                referral: start.referral,
                affiliate: start.affiliate,
                campaign: start.campaign,
                visitorKey: start.visitorKey,
                visitorUser: start.visitorUser,
                eventType: milestone,
                eventAt: new Date(),
                watchSeconds: elapsedSeconds,
                status: 'RECORDED',
                videoSessionHash: start.videoSessionHash,
            }]);
        } catch (error) {
            if (error.code === 11000) {
                const racedEvent = await AffiliateReferralEvent.findOne({
                    videoSessionHash: start.videoSessionHash,
                    eventType: milestone,
                });
                if (racedEvent) return { accepted: true, duplicate: true, milestone };
            }
            throw error;
        }
    }
    if (milestone !== 'VIDEO_COMPLETE') return { accepted: true, milestone, eventId: event._id };
    const requiredSeconds = Math.max(config.watchThresholdSeconds, campaign.minimumWatchSeconds || 0);
    const requiredPercent = campaign.minimumWatchPercent || 0;
    if (elapsedSeconds < requiredSeconds || elapsedSeconds * 100 < campaign.videoDurationSeconds * requiredPercent) {
        return { accepted: true, qualified: false, reason: 'WATCH_THRESHOLD_NOT_MET', eventId: event._id };
    }
    const affiliateOwner = await AffiliateProfile.findById(start.affiliate).select('user');
    const isSelfReferral = Boolean(affiliateOwner && (
        (start.visitorUser && String(start.visitorUser) === String(affiliateOwner.user))
        || (userId && String(userId) === String(affiliateOwner.user))
    ));
    if (isSelfReferral && config.selfReferralPolicy === 'REJECT_OWN_ACCOUNT') {
        event.status = 'SELF_REFERRAL';
        event.reasonCode = 'OWN_ACCOUNT';
        await event.save();
        return { accepted: true, qualified: false, reason: 'SELF_REFERRAL', eventId: event._id };
    }
    const cutoff = new Date(Date.now() - config.visitorUniquenessDays * 86400000);
    const repeat = await AffiliateReferralEvent.exists({
        _id: { $ne: event._id },
        affiliate: start.affiliate,
        visitorKey: start.visitorKey,
        eventType: 'REWARD_QUALIFIED',
        eventAt: { $gte: cutoff },
    });
    if (repeat) {
        event.status = 'DUPLICATE';
        event.reasonCode = 'VISITOR_ALREADY_REWARDED';
        await event.save();
        return { accepted: true, qualified: false, reason: 'DUPLICATE_VISITOR', eventId: event._id };
    }

    const packageRecord = await AffiliateProfile.findById(start.affiliate).populate('activePackage');
    const rewardMinor = require('../utils/affiliateMoney').toMinorUnits(packageRecord.activePackage.videoReward);
    const indiaDateKey = getIndiaDateKey();
    const cap = packageRecord.activePackage.dailyReferralCap;
    let rewardEvent;
    try {
        rewardEvent = await runInTransaction(async (session) => {
        const lock = await AffiliateVisitorRewardLock.findOne({
            affiliate: start.affiliate,
            visitorKey: start.visitorKey,
        }).select('+visitorKey').session(session);
        const now = new Date();
        if (lock && lock.expiresAt > now) {
            event.status = 'DUPLICATE';
            event.reasonCode = 'VISITOR_ALREADY_REWARDED';
            await event.save({ session });
            return event;
        }
        let dailyCap = await AffiliateDailyCap.findOne({ affiliate: start.affiliate, indiaDateKey }).session(session);
        if (!dailyCap) {
            try {
                [dailyCap] = await AffiliateDailyCap.create([{ affiliate: start.affiliate, indiaDateKey }], { session });
            } catch (error) {
                if (error.code !== 11000) throw error;
                dailyCap = await AffiliateDailyCap.findOne({ affiliate: start.affiliate, indiaDateKey }).session(session);
            }
        }
        if (config.dailyCapMode === 'RESERVE_ON_RECEIPT') {
            const reserved = await AffiliateDailyCap.findOneAndUpdate({
                _id: dailyCap._id,
                $expr: { $lt: [{ $add: ['$approvedCount', '$reservedCount'] }, cap] },
            }, { $inc: { reservedCount: 1 }, $set: { updatedAt: new Date() } }, { new: true, session });
            if (!reserved) {
                event.status = 'CAP_EXCEEDED';
                event.reasonCode = 'DAILY_CAP_REACHED';
                await event.save({ session });
                return event;
            }
        }
        const [qualified] = await AffiliateReferralEvent.create([{
            referral: start.referral,
            affiliate: start.affiliate,
            campaign: start.campaign,
            visitorKey: start.visitorKey,
            visitorUser: start.visitorUser,
            eventType: 'REWARD_QUALIFIED',
            eventAt: new Date(),
            watchSeconds: elapsedSeconds,
            status: 'PENDING_REVIEW',
            reasonCode: isSelfReferral ? 'SELF_REFERRAL_REVIEW' : null,
            dailyKey: indiaDateKey,
            rewardAmount: packageRecord.activePackage.videoReward,
            videoSessionHash: `${start.videoSessionHash}:reward`,
        }], { session });
        if (lock) {
            const updatedLock = await AffiliateVisitorRewardLock.findOneAndUpdate(
                { _id: lock._id, expiresAt: { $lte: now } },
                { $set: { event: qualified._id, expiresAt: new Date(now.getTime() + config.visitorUniquenessDays * 86400000) } },
                { new: true, session },
            );
            if (!updatedLock) throw referralError('Visitor reward was concurrently claimed.', 409);
        } else {
            await AffiliateVisitorRewardLock.create([{
                affiliate: start.affiliate,
                visitorKey: start.visitorKey,
                event: qualified._id,
                expiresAt: new Date(now.getTime() + config.visitorUniquenessDays * 86400000),
            }], { session });
        }
        await postEntry({
            affiliate: start.affiliate,
            idempotencyKey: `video:${qualified._id}:pending`,
            sourceType: 'VIDEO_REWARD',
            sourceId: qualified._id,
            bucket: 'PENDING',
            direction: 'CREDIT',
            amountMinor: rewardMinor,
            description: 'Pending qualified video referral reward.',
            session,
        });
        return qualified;
        });
    } catch (error) {
        if (error.code === 11000) {
            const lock = await AffiliateVisitorRewardLock.findOne({
                affiliate: start.affiliate,
                visitorKey: start.visitorKey,
                expiresAt: { $gt: new Date() },
            });
            if (lock) {
                event.status = 'DUPLICATE';
                event.reasonCode = 'VISITOR_ALREADY_REWARDED';
                await event.save();
                return { accepted: true, qualified: false, reason: 'DUPLICATE_VISITOR', eventId: event._id };
            }
        }
        throw error;
    }
    return {
        accepted: true,
        qualified: rewardEvent.status === 'PENDING_REVIEW',
        status: rewardEvent.status,
        eventId: rewardEvent._id,
        rewardAmount: rewardEvent.rewardAmount,
    };
}

module.exports = {
    ATTRIBUTION_COOKIE,
    CONSENT_COOKIE,
    VISITOR_COOKIE,
    captureCustomerAttribution,
    hashVisitorId,
    recordVideoProgress,
    resolveOrderAttribution,
    startVideoSession,
    trackReferralVisit,
};
