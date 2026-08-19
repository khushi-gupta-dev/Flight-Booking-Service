const express = require("express");

const router = express.Router();
const bookingRoutes = require("./booking-routes");



    router.use("/bookings", bookingRoutes);


// router.get("/info", (req, res) => {
//     res.send({
//             msg:"ok"
//         })
//     })
module.exports = router;