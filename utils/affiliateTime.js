function getIndiaDateKey(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

function addCalendarDays(date, days) {
    if (!Number.isInteger(days) || days < 1) throw new RangeError('Days must be a positive integer.');
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

module.exports = { addCalendarDays, getIndiaDateKey };
