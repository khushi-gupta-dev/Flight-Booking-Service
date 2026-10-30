const express = require("express");
const controller = require("../../controllers/recovery-controller");

const router = express.Router();
router.get("/", controller.list);
router.get("/:id", controller.detail);
router.post("/:id/approve", controller.approve);
router.post("/:id/decline", controller.decline);

module.exports = router;
