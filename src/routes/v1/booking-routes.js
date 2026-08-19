const express = require("express");



const { bookingController } = require("../../controllers");
const router = express.Router();
router.post(
    "/",
    bookingController.createBooking
);

router.post(
    '/payments',
    bookingController.makePayment
);




module.exports = router; 