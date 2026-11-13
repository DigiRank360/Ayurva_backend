const AffiliateNotification = require('../models/AffiliateNotification');

async function enqueueNotification({ user, eventType, dedupeKey, payload = {}, channel = 'IN_APP', templateVersion = null }) {
    return AffiliateNotification.findOneAndUpdate(
        { dedupeKey },
        {
            $setOnInsert: {
                user,
                eventType,
                channel,
                dedupeKey,
                payload,
                templateVersion,
                status: 'QUEUED',
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    );
}

module.exports = { enqueueNotification };
