const cron = require('node-cron');

const { bookingService } = require('../../services');

function scheduleCrons() {
    cron.schedule('* * * * *', async () => {
        await bookingService.cancelOldBookings();
    });
}

module.exports = scheduleCrons;
