const cron = require('node-cron');

const { bookingService } = require('../../services');

function scheduleCrons() {
    cron.schedule('*/30 * * * *', async () => {
        await bookingService.cancelOldBookings();
    });
}

module.exports = scheduleCrons;