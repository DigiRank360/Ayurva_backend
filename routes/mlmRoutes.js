const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const uploadKycDocuments = require('../middleware/kycUploadMiddleware');
const { uploadLimiter } = require('../middleware/rateLimitMiddleware');
const {
    activateEnrollment,
    createWithdrawal,
    decideWithdrawal,
    enroll,
    getAdminWithdrawals,
    getMlmAdminSummary,
    getMlmMembers,
    getMyCommissions,
    getMyMember,
    getMyNetwork,
    getMyPackagePaymentConfig,
    createMyPackagePaymentOrder,
    getMyPackagePaymentStatus,
    verifyMyPackagePayment,
    getAdminPackagePayments,
    reviewAdminPackagePayment,
    getMyKycConfig,
    getMyKyc,
    submitMyKyc,
    getAdminKycQueue,
    getAdminKycConfig,
    downloadAdminKycDocument,
    reviewAdminKyc,
    getMyVolumeHistory,
    getMyWithdrawals,
    getPayoutRuns,
    getReferralInfo,
    listPackages,
    register,
    runPayouts,
} = require('../controllers/mlmController');

const router = express.Router();

router.get('/packages', listPackages);
router.post('/register', register);
router.get('/referrals/:memberCode/placements', getReferralInfo);
router.post('/enroll', protect, enroll);
router.get('/me', protect, getMyMember);
router.get('/me/commissions', protect, getMyCommissions);
router.get('/me/network', protect, getMyNetwork);
router.get('/me/volume', protect, getMyVolumeHistory);
router.get('/me/payment/config', protect, getMyPackagePaymentConfig);
router.post('/me/payment/order', protect, createMyPackagePaymentOrder);
router.get('/me/payment/status', protect, getMyPackagePaymentStatus);
router.post('/me/payment/verify', protect, verifyMyPackagePayment);
router.get('/me/kyc/config', protect, getMyKycConfig);
router.get('/me/kyc', protect, getMyKyc);
router.post('/me/kyc', protect, uploadLimiter, (req, res, next) => {
    uploadKycDocuments(req, res, (error) => {
        if (error) {
            error.statusCode = 400;
            return next(error);
        }
        next();
    });
}, submitMyKyc);
router.get('/me/withdrawals', protect, getMyWithdrawals);
router.post('/me/withdrawals', protect, createWithdrawal);
router.get('/admin/summary', protect, admin, getMlmAdminSummary);
router.get('/admin/payout-runs', protect, admin, getPayoutRuns);
router.get('/admin/members', protect, admin, getMlmMembers);
router.get('/admin/withdrawals', protect, admin, getAdminWithdrawals);
router.put('/admin/withdrawals/:withdrawalId', protect, admin, decideWithdrawal);
router.get('/admin/kyc', protect, admin, getAdminKycQueue);
router.get('/admin/kyc/config', protect, admin, getAdminKycConfig);
router.get('/admin/kyc/:kycId/documents/:type', protect, admin, downloadAdminKycDocument);
router.put('/admin/kyc/:kycId/review', protect, admin, reviewAdminKyc);
router.get('/admin/package-payments', protect, admin, getAdminPackagePayments);
router.put('/admin/package-payments/:paymentId/review', protect, admin, reviewAdminPackagePayment);
router.post('/admin/members/:memberId/activate', protect, admin, activateEnrollment);
router.post('/admin/payouts/run', protect, admin, runPayouts);

module.exports = router;