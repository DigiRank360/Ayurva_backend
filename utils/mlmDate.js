function getIndiaDateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function getPreviousIndiaDateKey(date = new Date()) {
    return getIndiaDateKey(new Date(date.getTime() - 24 * 60 * 60 * 1000));
}

module.exports = { getIndiaDateKey, getPreviousIndiaDateKey };