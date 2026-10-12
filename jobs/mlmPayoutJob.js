const cron = require('node-cron');
const { runPendingDailyPayouts } = require('../services/mlmCommissionService');

function startMlmPayoutJob() {
    const processPendingDates = async () => {
        try {
            const results = await runPendingDailyPayouts();
            results.forEach((result) => console.log(`MLM payout run ${result.dateKey}: ${result.status}`));
        } catch (error) {
            console.error('MLM payout recovery failed:', error.message);
        }
    };

    const task = cron.schedule('*/10 * * * *', processPendingDates, { timezone: 'Asia/Kolkata' });
    processPendingDates();
    return task;
}

module.exports = { startMlmPayoutJob };