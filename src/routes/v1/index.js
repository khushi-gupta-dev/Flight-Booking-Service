const express = require("express");

const router = express.Router();
const bookingRoutes = require("./booking-routes");
const recoveryRoutes = require("./recovery-routes");
const recoveryOperationRoutes = require("./recovery-operation-routes");



    router.use("/bookings", bookingRoutes);
    router.use("/recovery-cases", recoveryRoutes);
    router.use("/recovery-operations", recoveryOperationRoutes);


// router.get("/info", (req, res) => {
//     res.send({
//             msg:"ok"
//         })
//     })
module.exports = router;