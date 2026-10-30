const express = require("express");
const controller = require("../../controllers/recovery-admin-controller");

const router = express.Router();
router.get("/", controller.list);
router.get("/summary", controller.summary);
router.post("/:id/assign-alternative", controller.assign);
router.post("/:id/override", controller.override);
router.post("/:id/retry", controller.retry);

module.exports = router;
