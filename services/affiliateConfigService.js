const AffiliateProgramConfig = require('../models/AffiliateProgramConfig');
const { writeAudit } = require('./affiliateAuditService');
const { runInTransaction } = require('./affiliateLedgerService');
const { toMinorUnits } = require('../utils/affiliateMoney');

const EDITABLE_FIELDS = [
    'featureEnabled',
    'attributionWindowDays',
    'attributionMode',
    'visitorUniquenessDays',
    'watchThresholdSeconds',
    'dailyCapMode',
    'renewalMode',
    'qualifyingRenewalTier',
    'rewardWindowStartConvention',
    'commissionBasePolicy',
    'partialRefundMode',
    'payoutMinimum',
    'payoutCurrency',
    'requiresKycForPayout',
    'requiresMakerChecker',
    'selfReferralPolicy',
    'affiliateAgreementVersion',
    'termsVersion',
    'privacyVersion',
    'supportConsentVersion',
    'referralConsentVersion',
    'kycConsentVersion',
    'legalApprovalReferences',
];

function incompleteConfiguration(config) {
    const required = [
        'attributionWindowDays',
        'attributionMode',
        'visitorUniquenessDays',
        'watchThresholdSeconds',
        'dailyCapMode',
        'renewalMode',
        'qualifyingRenewalTier',
        'rewardWindowStartConvention',
        'commissionBasePolicy',
        'partialRefundMode',
        'payoutMinimum',
        'selfReferralPolicy',
        'affiliateAgreementVersion',
        'termsVersion',
        'privacyVersion',
        'supportConsentVersion',
        'referralConsentVersion',
        'kycConsentVersion',
    ];
    return required.filter((key) => config[key] === null || config[key] === undefined || config[key] === '');
}

async function getActiveConfig(session) {
    let query = AffiliateProgramConfig.findOne({ status: 'ACTIVE' }).sort({ version: -1 });
    if (session) query = query.session(session);
    return query.lean();
}

async function listConfigVersions() {
    return AffiliateProgramConfig.find()
        .sort({ version: -1 })
        .limit(50)
        .lean();
}

async function getPortalSettings() {
    const config = await getActiveConfig();
    const enabled = Boolean(config?.featureEnabled) && incompleteConfiguration(config).length === 0;
    if (!enabled) return { enabled: false, policies: null, payout: null };
    return {
        enabled: true,
        policies: {
            affiliateAgreementVersion: config.affiliateAgreementVersion,
            termsVersion: config.termsVersion,
            privacyVersion: config.privacyVersion,
            referralConsentVersion: config.referralConsentVersion,
            supportConsentVersion: config.supportConsentVersion,
            kycConsentVersion: config.kycConsentVersion,
        },
        payout: {
            minimum: config.payoutMinimum.toString(),
            currency: config.payoutCurrency,
            requiresKyc: config.requiresKycForPayout,
        },
    };
}

async function getPublicReferralPolicy() {
    const config = await getActiveConfig();
    const enabled = Boolean(config?.featureEnabled)
        && Boolean(config.referralConsentVersion)
        && incompleteConfiguration(config).length === 0;
    return {
        enabled,
        referralConsentVersion: enabled ? config.referralConsentVersion : null,
    };
}

async function assertAffiliateFeatureEnabled(session) {
    const config = await getActiveConfig(session);
    if (!config || !config.featureEnabled) {
        const error = new Error('Affiliate programme is not enabled.');
        error.statusCode = 503;
        throw error;
    }
    const missing = incompleteConfiguration(config);
    if (missing.length) {
        const error = new Error(`Affiliate programme configuration is incomplete: ${missing.join(', ')}.`);
        error.statusCode = 503;
        throw error;
    }
    return config;
}

async function createConfigDraft(actor, reason, req) {
    if (!reason || reason.trim().length < 5) throw configError('A clear configuration change reason is required.');
    const latest = await AffiliateProgramConfig.findOne().sort({ version: -1 }).lean();
    const values = latest ? Object.fromEntries(EDITABLE_FIELDS
        .filter((field) => latest[field] !== undefined)
        .map((field) => [field, latest[field]])) : {};
    const draft = await AffiliateProgramConfig.create({
        ...values,
        version: (latest?.version || 0) + 1,
        status: 'DRAFT',
        featureEnabled: false,
        changeReason: reason.trim(),
        createdBy: actor,
    });
    await writeAudit({
        actor,
        action: 'AFFILIATE_CONFIG_DRAFT_CREATED',
        resourceType: 'AffiliateProgramConfig',
        resourceId: draft._id,
        after: { version: draft.version, status: draft.status },
        reason,
        req,
    });
    return draft;
}

async function updateConfigDraft({ configId, values, reason, actor, req }) {
    if (!reason || reason.trim().length < 5) throw configError('A clear configuration change reason is required.');
    const unsupported = Object.keys(values || {}).filter((field) => !EDITABLE_FIELDS.includes(field));
    if (unsupported.length) throw configError(`Unsupported configuration fields: ${unsupported.join(', ')}.`);
    const config = await AffiliateProgramConfig.findOne({ _id: configId, status: 'DRAFT' });
    if (!config) throw configError('Configuration draft was not found or is no longer editable.', 404);
    const before = {};
    const after = {};
    for (const [field, value] of Object.entries(values || {})) {
        before[field] = config.get(field);
        config.set(field, value);
        after[field] = value;
    }
    config.changeReason = reason.trim();
    await config.save();
    await writeAudit({
        actor,
        action: 'AFFILIATE_CONFIG_DRAFT_UPDATED',
        resourceType: 'AffiliateProgramConfig',
        resourceId: config._id,
        before,
        after,
        reason,
        req,
    });
    return config;
}

async function activateConfigVersion({ configId, actor, req }) {
    return runInTransaction(async (session) => {
        const config = await AffiliateProgramConfig.findOne({ _id: configId, status: 'DRAFT' }).session(session);
        if (!config) throw configError('Configuration draft was not found or is no longer activatable.', 404);
        const missing = incompleteConfiguration(config);
        if (missing.length) throw configError(`Configuration is incomplete: ${missing.join(', ')}.`);
        if (!config.legalApprovalReferences?.length) throw configError('At least one legal/finance approval reference is required.');
        if (toMinorUnits(config.payoutMinimum) <= 0) throw configError('Payout minimum must be greater than zero.');

        await AffiliateProgramConfig.updateMany(
            { status: 'ACTIVE' },
            { $set: { status: 'RETIRED' } },
            { session },
        );
        config.status = 'ACTIVE';
        config.activatedAt = new Date();
        await config.save({ session });
        await writeAudit({
            actor,
            action: 'AFFILIATE_CONFIG_ACTIVATED',
            resourceType: 'AffiliateProgramConfig',
            resourceId: config._id,
            after: { version: config.version, status: config.status, featureEnabled: config.featureEnabled },
            reason: config.changeReason,
            req,
            session,
        });
        return config;
    });
}

function configError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

module.exports = {
    activateConfigVersion,
    assertAffiliateFeatureEnabled,
    createConfigDraft,
    getPortalSettings,
    getPublicReferralPolicy,
    getActiveConfig,
    incompleteConfiguration,
    listConfigVersions,
    updateConfigDraft,
};
