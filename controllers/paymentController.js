const asyncHandler = require('express-async-handler');
const paymentService = require('../services/retailPaymentService');

const createPaymentOrder = asyncHandler(async (req, res) => {
    const paymentOrder = await paymentService.createPaymentOrder(req.user._id, req.body.orderId);
    res.json(paymentOrder);
});

const verifyPayment = asyncHandler(async (req, res) => {
    const result = await paymentService.verifyPaymentForOrder(req.user._id, req.body);
    res.json(result);
});

module.exports = { createPaymentOrder, verifyPayment };
