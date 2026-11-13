const models = [
    require('../models/AffiliateAttribution'),
    require('../models/AffiliateAuditLog'),
    require('../models/AffiliateCampaign'),
    require('../models/AffiliateCommission'),
    require('../models/AffiliateCommissionAdjustment'),
    require('../models/AffiliateCommissionRule'),
    require('../models/AffiliateConsent'),
    require('../models/AffiliateDailyCap'),
    require('../models/AffiliateKyc'),
    require('../models/AffiliateKycDocument'),
    require('../models/AffiliateNotification'),
    require('../models/AffiliateOrderSettlement'),
    require('../models/AffiliatePackage'),
    require('../models/AffiliatePayoutMethod'),
    require('../models/AffiliatePayoutRequest'),
    require('../models/AffiliatePayoutTransaction'),
    require('../models/AffiliateProfile'),
    require('../models/AffiliateProgramConfig'),
    require('../models/AffiliateReferralEvent'),
    require('../models/AffiliateReferralLink'),
    require('../models/AffiliateRenewalEvent'),
    require('../models/AffiliateRewardWindow'),
    require('../models/AffiliateSupportEntitlement'),
    require('../models/AffiliateSupportSession'),
    require('../models/AffiliateVisitorRewardLock'),
    require('../models/AffiliateWalletAccount'),
    require('../models/AffiliateWalletEntry'),
    require('../models/AffiliateWebhookEvent'),
    require('../models/OfferRedemption'),
    require('../models/Order'),
    require('../models/Payment'),
    require('../models/PaymentRefundEvent'),
    require('../models/PaymentRefundRequest'),
];

async function initializeAffiliateIndexes() {
    for (const model of models) {
        await model.createIndexes();
    }
}

module.exports = { initializeAffiliateIndexes };
