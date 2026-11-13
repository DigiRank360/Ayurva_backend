const cron = require('node-cron');
const AffiliateOrderSettlement = require('../models/AffiliateOrderSettlement');
const { processAffiliateOrderSettlement } = require('../services/retailPaymentService');

async function retryAffiliateSettlements() {
    const now = new Date();
    const pending = await AffiliateOrderSettlement.find({
        status: { $in: ['PENDING', 'BLOCKED', 'FAILED', 'PROCESSING'] },
        $or: [{ lockUntil: null }, { lockUntil: { $lte: now } }],
    }).sort({ updatedAt: 1 }).limit(50).select('order').lean();
    for (const settlement of pending) {
        await processAffiliateOrderSettlement(settlement.order);
    }
}

function startAffiliateSettlementJob() {
    const run = async () => {
        try {
            await retryAffiliateSettlements();
        } catch (error) {
            console.error('Affiliate settlement retry failed:', error.message);
        }
    };
    const task = cron.schedule('*/5 * * * *', run, { timezone: 'Asia/Kolkata' });
    run();
    return task;
}

module.exports = { retryAffiliateSettlements, startAffiliateSettlementJob };
