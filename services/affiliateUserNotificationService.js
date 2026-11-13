const AffiliateNotification = require('../models/AffiliateNotification');

async function listNotifications(userId, page = 1, limit = 25) {
    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 25));
    const filter = { user: userId, channel: 'IN_APP' };
    const [items, total, unread] = await Promise.all([
        AffiliateNotification.find(filter)
            .sort({ createdAt: -1 })
            .skip((safePage - 1) * safeLimit)
            .limit(safeLimit)
            .select('eventType payload status createdAt sentAt readAt')
            .lean(),
        AffiliateNotification.countDocuments(filter),
        AffiliateNotification.countDocuments({ ...filter, status: { $ne: 'READ' } }),
    ]);
    return { items, page: safePage, limit: safeLimit, total, unread };
}

async function markNotificationRead(userId, notificationId) {
    const notification = await AffiliateNotification.findOneAndUpdate(
        { _id: notificationId, user: userId, channel: 'IN_APP' },
        { $set: { status: 'READ', readAt: new Date() } },
        { new: true },
    ).select('eventType status createdAt readAt');
    if (!notification) {
        const error = new Error('Notification not found.');
        error.statusCode = 404;
        throw error;
    }
    return notification;
}

module.exports = { listNotifications, markNotificationRead };
