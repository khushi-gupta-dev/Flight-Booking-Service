const express = require("express");



const { bookingController } = require("../../controllers");
const router = express.Router();
router.get('/admin', bookingController.getAllBookings);
router.get('/', bookingController.getCustomerBookings);
router.get('/:id', bookingController.getCustomerBooking);
router.post('/:id/cancel', bookingController.cancelCustomerBooking);
router.post(
    "/",
    bookingController.createBooking
);

router.post(
    '/payments/order',
    bookingController.createPaymentOrder
);

router.post(
    '/:id/payments/verify',
    bookingController.verifyRazorpayPayment
);

router.post(
    '/payments',
    bookingController.makePayment
);




module.exports = router; 
