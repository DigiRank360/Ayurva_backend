
const express = require('express');
const router = express.Router();
const {
    handleShiprocketWebhook,
    handleRazorpayWebhook,
    testStatusUpdate
} = require('../controllers/webhookController');
const { protect, admin } = require('../middleware/authMiddleware');

// Shiprocket webhook (public, no auth)
router.post('/shiprocket', handleShiprocketWebhook);
router.post('/razorpay', handleRazorpayWebhook);

// Test webhook (admin only)
router.post('/test-update', protect, admin, testStatusUpdate);

module.exports = router;
