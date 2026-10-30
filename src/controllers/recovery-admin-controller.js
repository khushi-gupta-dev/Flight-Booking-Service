const { StatusCodes } = require("http-status-codes");
const recoveryAdminService = require("../services/recovery-admin-service");

function adminId(req, res) {
  const value = Number(req.headers["x-user-id"]);
  if (!Number.isInteger(value) || value < 1) {
    res.status(StatusCodes.UNAUTHORIZED).json({ success: false, message: "Administrator authentication required." });
    return null;
  }
  return value;
}

function sendError(res, error) {
  return res.status(error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: error.message || "The recovery operations service could not complete this request.",
    error: { message: error.message || "Unexpected error." },
  });
}

async function list(req, res) {
  if (!adminId(req, res)) return;
  try { return res.json({ success: true, data: await recoveryAdminService.listOperations(req.query) }); } catch (error) { return sendError(res, error); }
}

async function summary(req, res) {
  if (!adminId(req, res)) return;
  try { return res.json({ success: true, data: await recoveryAdminService.getSummary(req.query) }); } catch (error) { return sendError(res, error); }
}

async function assign(req, res) {
  const id = adminId(req, res);
  if (!id) return;
  try {
    return res.status(StatusCodes.OK).json({
      success: true,
      data: await recoveryAdminService.assignAlternative({
        id: Number(req.params.id),
        flightId: Number(req.body?.flightId),
        adminId: id,
        reason: req.body?.reason,
      }),
    });
  } catch (error) { return sendError(res, error); }
}

async function override(req, res) {
  const id = adminId(req, res);
  if (!id) return;
  try {
    return res.status(StatusCodes.OK).json({
      success: true,
      data: await recoveryAdminService.overrideCase({
        id: Number(req.params.id),
        adminId: id,
        action: req.body?.action,
        alternativeId: Number(req.body?.alternativeId),
        reason: req.body?.reason,
      }),
    });
  } catch (error) { return sendError(res, error); }
}

async function retry(req, res) {
  const id = adminId(req, res);
  if (!id) return;
  try {
    return res.status(StatusCodes.ACCEPTED).json({
      success: true,
      data: await require("../services/recovery-service").adminRetryRecoveryCase({ id: Number(req.params.id), adminId: id }),
    });
  } catch (error) { return sendError(res, error); }
}

module.exports = { list, summary, assign, override, retry };
