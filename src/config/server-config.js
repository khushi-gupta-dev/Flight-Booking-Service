const dotenv = require('dotenv');

dotenv.config();

module.exports = {
    PORT: process.env.PORT,
    FLIGHT_SERVICE: process.env.FLIGHT_SERVICE,
    RECOVERY_SEARCH_WINDOW_HOURS: Number(process.env.RECOVERY_SEARCH_WINDOW_HOURS || 48),
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
    RAZORPAY_CURRENCY: process.env.RAZORPAY_CURRENCY || 'INR'
}
