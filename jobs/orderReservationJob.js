const cron = require('node-cron');
const { expireOrderReservations } = require('../services/retailOrderService');

function startOrderReservationJob() {
    const expireReservations = async () => {
        try {
            const expired = await expireOrderReservations();
            if (expired) console.log(`Expired ${expired} unpaid order reservation(s).`);
        } catch (error) {
            console.error('Order reservation expiry failed:', error.message);
        }
    };

    const task = cron.schedule('* * * * *', expireReservations, { timezone: 'Asia/Kolkata' });
    expireReservations();
    return task;
}

module.exports = { startOrderReservationJob };
