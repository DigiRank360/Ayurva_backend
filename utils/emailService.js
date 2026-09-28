const sendResendEmail = async ({ to, subject, html }) => {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;

    if (!apiKey || !from) {
        console.log('Resend is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.');
        return false;
    }

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ from, to, subject, html })
        });
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(result.message || `Resend request failed (${response.status})`);
        }

        return true;
    } catch (error) {
        console.error('Resend email error:', error.message);
        return false;
    }
};

// Send order confirmation email
const sendOrderConfirmation = async (order, userEmail) => {
    return sendResendEmail({
        to: userEmail,
        subject: `Order Confirmation - #${order._id}`,
        html: `
                <h1>Order Confirmed!</h1>
                <p>Thank you for your order.</p>
                <h3>Order Details:</h3>
                <p><strong>Order ID:</strong> ${order._id}</p>
                <p><strong>Total:</strong> ₹${order.totalPrice}</p>
                <p><strong>Payment Method:</strong> ${order.paymentMethod}</p>
                <p><strong>Status:</strong> ${order.orderStatus}</p>
                <p>Thank you for shopping with Luga Vastra!</p>
            `
    });
};

// Send order status update email
const sendOrderStatusUpdate = async (order, userEmail) => {
    return sendResendEmail({
        to: userEmail,
        subject: `Order Update - #${order._id}`,
        html: `
                <h1>Order Status Updated</h1>
                <p><strong>Order ID:</strong> ${order._id}</p>
                <p><strong>New Status:</strong> ${order.orderStatus}</p>
                <p>Thank you for shopping with Luga Vastra!</p>
            `
    });
};

module.exports = {
    sendOrderConfirmation,
    sendOrderStatusUpdate
};
