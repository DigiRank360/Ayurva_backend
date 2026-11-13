const express = require('express');
const controller = require('../controllers/affiliateController');
const { protect } = require('../middleware/authMiddleware');
const { optionalProtect, requireAffiliateRoles } = require('../middleware/affiliateAuthorization');
const uploadKycDocuments = require('../middleware/kycUploadMiddleware');
const { uploadLimiter } = require('../middleware/rateLimitMiddleware');

const router = express.Router();
const customerOrPartner = requireAffiliateRoles('customer', 'affiliate_partner');
const partner = requireAffiliateRoles('affiliate_partner');
const finance = requireAffiliateRoles('finance_operator', 'super_admin');
const affiliateManager = requireAffiliateRoles('affiliate_manager', 'super_admin');

router.get('/packages', controller.getPackages);
router.post('/referrals/:token/visit', optionalProtect, controller.trackReferral);

router.post('/enroll', protect, customerOrPartner, controller.enroll);
router.post('/packages/orders', protect, customerOrPartner, controller.createPackageOrder);
router.get('/profile', protect, partner, controller.getProfile);
router.patch('/profile', protect, partner, controller.updateProfile);
router.get('/dashboard', protect, partner, controller.dashboard);
router.get('/activity', protect, partner, controller.activity);
router.post('/links', protect, partner, controller.createLink);
router.post('/consents', protect, customerOrPartner, controller.consent);
router.get('/notifications', protect, customerOrPartner, controller.listNotifications);
router.patch('/notifications/:notificationId/read', protect, customerOrPartner, controller.markNotificationRead);
router.post('/videos/:token/start', optionalProtect, controller.startVideo);
router.post('/videos/progress', optionalProtect, controller.recordVideoProgress);

router.get('/kyc/status', protect, partner, controller.kycStatus);
router.post('/kyc', protect, partner, uploadLimiter, uploadKycDocuments, controller.submitKyc);
router.get('/payout-method', protect, partner, controller.payoutMethod);
router.put('/payout-method', protect, partner, controller.setPayoutMethod);
router.post('/payouts', protect, partner, controller.requestPayout);
router.get('/payouts', protect, partner, controller.myPayouts);

router.post('/support/sessions', protect, customerOrPartner, controller.scheduleSupportSession);
router.get('/support/sessions', protect, requireAffiliateRoles(
    'doctor', 'support_agent', 'affiliate_manager', 'super_admin', 'customer', 'affiliate_partner',
), controller.listSupportSessions);
router.patch('/support/sessions/:sessionId/assignment', protect, affiliateManager, controller.assignSupportSession);
router.patch('/support/sessions/:sessionId/outcome', protect, requireAffiliateRoles('doctor', 'support_agent'), controller.updateSupportOutcome);
router.get('/support/sessions/:sessionId/notes', protect, requireAffiliateRoles('doctor'), controller.doctorNotes);

router.get('/admin/commissions', protect, requireAffiliateRoles('finance_operator', 'affiliate_manager', 'super_admin'), controller.listCommissionQueue);
router.post('/admin/commissions/:commissionId/review', protect, requireAffiliateRoles('finance_operator', 'affiliate_manager', 'super_admin'), controller.reviewCommission);
router.post('/admin/video-rewards/:eventId/review', protect, affiliateManager, controller.reviewVideoReward);
router.get('/admin/payouts', protect, finance, controller.listPayoutQueue);
router.post('/admin/payouts/:payoutId/review', protect, finance, controller.reviewPayout);
router.post('/admin/payouts/:payoutId/process', protect, finance, controller.processPayout);
router.post('/admin/payouts/:payoutId/settle', protect, finance, controller.settlePayout);
router.get('/admin/payout-methods', protect, finance, controller.listPayoutMethodQueue);
router.post('/admin/payout-methods/:methodId/review', protect, finance, controller.reviewPayoutMethod);
router.get('/admin/kyc', protect, finance, controller.listKycApplications);
router.get('/admin/kyc/:applicationId', protect, finance, controller.getKycApplication);
router.post('/admin/kyc/:applicationId/review', protect, finance, controller.reviewKyc);
router.get('/admin/kyc/documents/:documentId', protect, finance, controller.downloadKycDocument);
router.get('/admin/config', protect, affiliateManager, controller.getAdminConfig);
router.post('/admin/config/drafts', protect, affiliateManager, controller.createConfigDraft);
router.patch('/admin/config/drafts/:configId', protect, affiliateManager, controller.updateConfigDraft);
router.post('/admin/config/:configId/activate', protect, affiliateManager, controller.activateConfig);
router.put('/admin/users/:userId/roles', protect, requireAffiliateRoles('super_admin'), controller.assignUserRoles);
router.get('/admin/packages', protect, affiliateManager, controller.listAdminPackages);
router.post('/admin/packages', protect, affiliateManager, controller.createPackageDraft);
router.post('/admin/packages/:packageId/activate', protect, affiliateManager, controller.activatePackage);
router.get('/admin/profiles/risk-review', protect, affiliateManager, controller.listRiskReviewProfiles);
router.post('/admin/profiles/:profileId/risk-review', protect, affiliateManager, controller.reviewAffiliateRisk);
router.get('/admin/commission-rules', protect, finance, controller.listCommissionRules);
router.post('/admin/commission-rules', protect, finance, controller.createCommissionRule);
router.post('/admin/commission-rules/:ruleId/activate', protect, finance, controller.activateCommissionRule);
router.get('/admin/reports/commissions.csv', protect, finance, controller.commissionsCsv);
router.get('/admin/reports/payouts.csv', protect, finance, controller.payoutsCsv);
router.get('/admin/campaigns', protect, affiliateManager, controller.listCampaigns);
router.post('/admin/campaigns', protect, affiliateManager, controller.createCampaign);
router.patch('/admin/campaigns/:campaignId', protect, affiliateManager, controller.updateCampaign);
router.post('/admin/campaigns/:campaignId/activate', protect, affiliateManager, controller.activateCampaign);

module.exports = router;
