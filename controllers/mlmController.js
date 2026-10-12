const asyncHandler = require('express-async-handler');
const MlmCommission = require('../models/MlmCommission');
const MlmMember = require('../models/MlmMember');
const MlmPayoutRun = require('../models/MlmPayoutRun');
const { getIndiaDateKey } = require('../utils/mlmDate');
const { runDailyPayouts } = require('../services/mlmCommissionService');
const { activateMember, enrollMember, getReferralPlacements, registerMember } = require('../services/mlmMemberService');
const { getPackages } = require('../services/mlmPackageService');
const { getCommissionHistory, getMemberForUser, getPlacementNetwork, getVolumeHistory } = require('../services/mlmReportService');
const { listWithdrawals, requestWithdrawal, reviewWithdrawal } = require('../services/mlmWithdrawalService');
const { createPackagePaymentOrder, getMemberPackagePaymentStatus, getPackagePaymentConfig, listPackagePayments, reviewPackagePayment, verifyPackagePayment } = require('../services/mlmPackagePaymentService');
const { getKycDocument, getKycQueue, getKycStorageConfig, getMyKycStatus, reviewKyc, submitKyc } = require('../services/mlmKycService');

const listPackages = (req, res) => res.json(getPackages());

const enroll = asyncHandler(async (req, res) => {
    const member = await enrollMember({ ...req.body, userId: req.user._id });
    res.status(201).json(member);
});

const register = asyncHandler(async (req, res) => {
    const result = await registerMember(req.body);
    res.cookie('jwt', result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV !== 'development',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    res.status(201).json(result);
});

const getReferralInfo = asyncHandler(async (req, res) => {
    res.json(await getReferralPlacements(req.params.memberCode));
});

const getMyMember = asyncHandler(async (req, res) => {
    const member = await getMemberForUser(req.user._id);
    res.json(member);
});

const getMyCommissions = asyncHandler(async (req, res) => {
    const member = await getMemberForUser(req.user._id);
    res.json(await getCommissionHistory(member._id, req.query.page, req.query.limit));
});

const getMyNetwork = asyncHandler(async (req, res) => {
    const member = await getMemberForUser(req.user._id);
    res.json(await getPlacementNetwork(member._id));
});

const getMyVolumeHistory = asyncHandler(async (req, res) => {
    const member = await getMemberForUser(req.user._id);
    res.json(await getVolumeHistory(member._id, req.query.days));
});

const getMyPackagePaymentConfig = (req, res) => res.json(getPackagePaymentConfig());

const createMyPackagePaymentOrder = asyncHandler(async (req, res) => {
    res.status(201).json(await createPackagePaymentOrder(req.user._id));
});

const getMyPackagePaymentStatus = asyncHandler(async (req, res) => {
    res.json(await getMemberPackagePaymentStatus(req.user._id));
});

const verifyMyPackagePayment = asyncHandler(async (req, res) => {
    const member = await verifyPackagePayment(req.user._id, {
        orderId: req.body.razorpay_order_id,
        paymentId: req.body.razorpay_payment_id,
        signature: req.body.razorpay_signature,
    });
    res.json(member);
});

const getAdminPackagePayments = asyncHandler(async (req, res) => {
    res.json(await listPackagePayments(req.query.status));
});

const reviewAdminPackagePayment = asyncHandler(async (req, res) => {
    res.json(await reviewPackagePayment({
        paymentId: req.params.paymentId,
        adminUserId: req.user._id,
        decision: req.body.decision,
        rejectionReason: req.body.rejectionReason,
    }));
});

const getMyKycConfig = (req, res) => res.json(getKycStorageConfig());

const getMyKyc = asyncHandler(async (req, res) => {
    res.json(await getMyKycStatus(req.user._id));
});

const submitMyKyc = asyncHandler(async (req, res) => {
    res.status(201).json(await submitKyc({ userId: req.user._id, body: req.body, files: req.files }));
});

const getAdminKycQueue = asyncHandler(async (req, res) => {
    res.json(await getKycQueue(req.query.status));
});

const getAdminKycConfig = (req, res) => res.json(getKycStorageConfig());

const downloadAdminKycDocument = asyncHandler(async (req, res) => {
    const document = await getKycDocument(req.params.kycId, req.params.type);
    res.set({
        'Cache-Control': 'no-store, private',
        'Content-Disposition': `attachment; filename="${document.filename}"`,
        'Content-Type': document.mimeType,
        'X-Content-Type-Options': 'nosniff',
    }).send(document.contents);
});

const reviewAdminKyc = asyncHandler(async (req, res) => {
    res.json(await reviewKyc({
        kycId: req.params.kycId,
        adminUserId: req.user._id,
        decision: req.body.decision,
        rejectionReason: req.body.rejectionReason,
    }));
});

const createWithdrawal = asyncHandler(async (req, res) => {
    const member = await getMemberForUser(req.user._id);
    const withdrawal = await requestWithdrawal({
        memberId: member._id,
        amount: req.body.amount,
        payoutDetails: req.body.payoutDetails,
    });
    res.status(201).json(withdrawal);
});

const getMyWithdrawals = asyncHandler(async (req, res) => {
    const member = await getMemberForUser(req.user._id);
    res.json(await listWithdrawals({ memberId: member._id, limit: req.query.limit }));
});

const getAdminWithdrawals = asyncHandler(async (req, res) => {
    res.json(await listWithdrawals({ status: req.query.status, limit: req.query.limit }));
});

const decideWithdrawal = asyncHandler(async (req, res) => {
    const withdrawal = await reviewWithdrawal({
        withdrawalId: req.params.withdrawalId,
        adminUserId: req.user._id,
        decision: req.body.decision,
        paymentReference: req.body.paymentReference,
        rejectionReason: req.body.rejectionReason,
    });
    res.json(withdrawal);
});

const activateEnrollment = asyncHandler(async (req, res) => {
    const member = await activateMember({
        memberId: req.params.memberId,
        paymentReference: req.body.paymentReference,
    });
    res.json(member);
});

const runPayouts = asyncHandler(async (req, res) => {
    const dateKey = req.body.dateKey || getIndiaDateKey();
    if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        return res.status(400).json({ message: 'dateKey must use YYYY-MM-DD format.' });
    }
    if (dateKey >= getIndiaDateKey()) {
        return res.status(400).json({ message: 'Manual payout runs are allowed only for a closed India date.' });
    }
    res.json(await runDailyPayouts(dateKey));
});

const getPayoutRuns = asyncHandler(async (req, res) => {
    const runs = await MlmPayoutRun.find().sort({ dateKey: -1 }).limit(60);
    res.json(runs);
});

const getMlmMembers = asyncHandler(async (req, res) => {
    const status = ['pending', 'active', 'suspended'].includes(req.query.status) ? req.query.status : 'pending';
    const members = await MlmMember.find({ status })
        .sort({ createdAt: -1 })
        .limit(100)
        .populate('user', 'name email phone');
    res.json(members);
});

const getMlmAdminSummary = asyncHandler(async (req, res) => {
    const [membersByStatus, totals] = await Promise.all([
        MlmMember.aggregate([
            { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        MlmCommission.aggregate([
            { $group: {
                _id: '$type',
                paid: { $sum: '$paidAmount' },
                flushed: { $sum: '$flushedAmount' },
                count: { $sum: 1 },
            } },
        ]),
    ]);
    res.json({ membersByStatus, commissions: totals });
});

module.exports = {
    listPackages,
    register,
    getReferralInfo,
    enroll,
    getMyMember,
    getMyCommissions,
    getMyNetwork,
    getMyVolumeHistory,
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
    createWithdrawal,
    getMyWithdrawals,
    getAdminWithdrawals,
    decideWithdrawal,
    activateEnrollment,
    getMlmMembers,
    runPayouts,
    getPayoutRuns,
    getMlmAdminSummary,
};