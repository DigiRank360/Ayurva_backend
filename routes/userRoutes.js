
const express = require('express');
const router = express.Router();
const {
    authUser,
    registerUser,
    getUserProfile,
    updateUserProfile,
    changeUserPassword,
    addUserAddress,
    getUserAddresses,
    updateUserAddress,
    deleteUserAddress,
    sendOTP,
    verifyOTP,
    setupMfa,
    confirmMfa,
    verifyMfaChallenge,
    forgotPassword,
    logoutUser
} = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');
const { authLimiter } = require('../middleware/rateLimitMiddleware');

router.post('/', authLimiter, registerUser);
router.post('/login', authLimiter, authUser);
router.post('/logout', logoutUser);
router.post('/send-otp', authLimiter, sendOTP);
router.post('/verify-otp', authLimiter, verifyOTP);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/mfa/verify-challenge', authLimiter, verifyMfaChallenge);
router.post('/mfa/setup', protect, authLimiter, setupMfa);
router.post('/mfa/confirm', protect, authLimiter, confirmMfa);
router.route('/profile')
    .get(protect, getUserProfile)
    .put(protect, updateUserProfile);
router.put('/profile/password', protect, changeUserPassword);
router.route('/addresses').get(protect, getUserAddresses);
router.route('/address').post(protect, addUserAddress);
router.route('/address/:addressId')
    .put(protect, updateUserAddress)
    .delete(protect, deleteUserAddress);

module.exports = router;
