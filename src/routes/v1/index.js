const express = require("express");

const router = express.Router();
const bookingRoutes = require("./booking-routes");
const recoveryRoutes = require("./recovery-routes");



    router.use("/bookings", bookingRoutes);
    router.use("/recovery-cases", recoveryRoutes);


// router.get("/info", (req, res) => {
//     res.send({
//             msg:"ok"
//         })
//     })
module.exports = router;