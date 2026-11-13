
const asyncHandler = require('express-async-handler');
const Order = require('../models/Order');
const retailOrderService = require('../services/retailOrderService');
const retailPaymentService = require('../services/retailPaymentService');

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
const addOrderItems = asyncHandler(async (req, res) => {
    const { order, created } = await retailOrderService.createRetailOrder(
        req.user._id,
        req.body,
        req.get('Idempotency-Key'),
        req,
    );
    try {
        if (!created) return res.status(200).json(order);
        const { sendOrderConfirmation } = require('../utils/emailService');
        await sendOrderConfirmation(order, req.user.email);
    } catch (error) {
        console.error('Order confirmation email failed:', error.message);
    }
    res.status(201).json(order);
});

// @desc    Get logged in user orders
// @route   GET /api/orders/myorders?page=1&limit=10
// @access  Private
const getMyOrders = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10 } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const orders = await Order.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum);

    const totalOrders = await Order.countDocuments({ user: req.user._id });

    res.json({
        orders,
        page: pageNum,
        pages: Math.ceil(totalOrders / limitNum),
        total: totalOrders
    });
});


// @desc    Get order by ID
// @route   GET /api/orders/:id
// @access  Private
const getOrderById = asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id).populate('user', 'name email');
    if (!order) {
        res.status(404);
        throw new Error('Order not found');
    }
    if (String(order.user._id) !== String(req.user._id) && !req.user.isAdmin) {
        res.status(403);
        throw new Error('Not authorized to view this order.');
    }
    res.json(order);
});

// @desc    Update order to paid (After Razorpay verification)
// @route   PUT /api/orders/:id/pay
// @access  Private
const updateOrderToPaid = asyncHandler(async (req, res) => {
    const result = await retailPaymentService.verifyPaymentForOrder(req.user._id, {
        razorpay_order_id: req.body.razorpayOrderId || req.body.razorpay_order_id,
        razorpay_payment_id: req.body.razorpayPaymentId || req.body.razorpay_payment_id,
        razorpay_signature: req.body.razorpaySignature || req.body.razorpay_signature,
    }, req.params.id);
    res.json(result);
});

// @desc    Process order (Admin starts processing)
// @route   PUT /api/orders/:id/process
// @access  Private/Admin
const processOrder = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (order) {
            if (order.orderStatus === 'Cancelled') {
                res.status(409);
                throw new Error('Cancelled orders cannot be processed.');
            }
            // COD orders can be processed directly, Razorpay must be paid
            if (order.paymentMethod === 'Razorpay' && order.paymentStatus !== 'Paid') {
                res.status(400).json({ message: 'Payment not completed yet' });
                return;
            }

            order.orderStatus = 'Processing';
            const updatedOrder = await order.save();
            res.json(updatedOrder);
        } else {
            res.status(404).json({ message: 'Order not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Ship order (Admin marks as shipped)
// @route   PUT /api/orders/:id/ship
// @access  Private/Admin
const shipOrder = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (order) {
            if (order.orderStatus !== 'Processing') {
                res.status(400).json({ message: 'Order must be in Processing state' });
                return;
            }

            order.orderStatus = 'Shipped';
            order.trackingNumber = req.body.trackingNumber || '';

            const updatedOrder = await order.save();
            res.json(updatedOrder);
        } else {
            res.status(404).json({ message: 'Order not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Update order to delivered
// @route   PUT /api/orders/:id/deliver
// @access  Private/Admin
const updateOrderToDelivered = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (order) {
            if (order.orderStatus !== 'Shipped') {
                res.status(400).json({ message: 'Order must be shipped first' });
                return;
            }

            order.isDelivered = true;
            order.deliveredAt = Date.now();
            order.orderStatus = 'Delivered';

            // For COD, mark as paid on delivery
            if (order.paymentMethod === 'COD') {
                order.paymentStatus = 'Paid';
                order.paymentResult = { paidAt: Date.now() };
            }

            const updatedOrder = await order.save();
            res.json(updatedOrder);
        } else {
            res.status(404).json({ message: 'Order not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Update order status manually (Admin force override)
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
const updateOrderStatusAdmin = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (order) {
            const { status } = req.body;
            const validStatuses = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];

            if (!validStatuses.includes(status)) {
                return res.status(400).json({ message: 'Invalid order status provided' });
            }

            if (status === 'Cancelled') {
                const cancelled = await retailOrderService.cancelOrder({
                    orderId: order._id,
                    userId: req.user._id,
                    isAdmin: true,
                    reason: req.body.reason || 'Cancelled by administrator',
                    req,
                });
                return res.json(cancelled.order);
            }
            order.orderStatus = status;

            // Handle special side-effects if status is directly forced to Delivered
            if (status === 'Delivered' && !order.isDelivered) {
                order.isDelivered = true;
                order.deliveredAt = Date.now();
                if (order.paymentMethod === 'COD' && order.paymentStatus !== 'Paid') {
                    order.paymentStatus = 'Paid';
                    order.paymentResult = { paidAt: Date.now() };
                }
            }

            const updatedOrder = await order.save();
            res.json(updatedOrder);
        } else {
            res.status(404).json({ message: 'Order not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Cancel Order
// @route   PUT /api/orders/:id/cancel
// @access  Private
const cancelOrder = asyncHandler(async (req, res) => {
    const { order, changed } = await retailOrderService.cancelOrder({
        orderId: req.params.id,
        userId: req.user._id,
        isAdmin: Boolean(req.user.isAdmin),
        reason: req.body.reason,
        req,
    });
    try {
        if (changed) {
        const { sendOrderStatusUpdate } = require('../utils/emailService');
        const User = require('../models/User');
        const user = await User.findById(order.user);
        if (user) await sendOrderStatusUpdate(order, user.email);
        }
    } catch (error) {
        console.error('Order cancellation email failed:', error.message);
    }
    res.json({ message: 'Order cancelled and reserved stock released.', order });
});



module.exports = {
    addOrderItems,
    getMyOrders,
    getOrderById,
    updateOrderToPaid,
    processOrder,
    shipOrder,
    updateOrderToDelivered,
    cancelOrder,
    updateOrderStatusAdmin
};
