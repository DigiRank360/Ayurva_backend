const crypto = require('crypto');
const AffiliateAuditLog = require('../models/AffiliateAuditLog');

function hashIp(ip) {
    if (!ip || !process.env.JWT_SECRET) return null;
    return crypto.createHmac('sha256', process.env.JWT_SECRET).update(ip).digest('hex');
}

async function writeAudit({ actor, action, resourceType, resourceId, reason, before, after, req, session }) {
    const [entry] = await AffiliateAuditLog.create([{
        actor: actor || req?.user?._id || null,
        action,
        resourceType,
        resourceId: String(resourceId),
        reason: reason || null,
        before: before || null,
        after: after || null,
        requestId: req?.id || req?.headers?.['x-request-id'] || null,
        ipHash: hashIp(req?.ip),
        userAgent: req?.get?.('user-agent')?.slice(0, 300) || null,
        occurredAt: new Date(),
    }], session ? { session } : {});
    return entry;
}

module.exports = { writeAudit };
