const { StatusCodes } = require("http-status-codes");
const recoveryService = require("../services/recovery-service");

function userId(req, res) {
  const value = Number(req.headers["x-user-id"]);
  if (!Number.isInteger(value) || value < 1) {
    res.status(StatusCodes.UNAUTHORIZED).json({ success: false, message: "Sign in to access recovery cases." });
    return null;
  }
  return value;
}

function sendError(res, error) {
  return res.status(error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: error.message || "The recovery service could not complete this request.",
    error: { message: error.message || "Unexpected error." },
  });
}

function caseId(req, res) {
  const value = Number(req.params.id);
  if (!Number.isInteger(value) || value < 1) {
    res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "A valid recovery case ID is required." });
    return null;
  }
  return value;
}

async function list(req, res) {
  const id = userId(req, res);
  if (!id) return;
  try { return res.json({ success: true, data: await recoveryService.getCustomerRecoveryCases(id) }); } catch (error) { return sendError(res, error); }
}

async function detail(req, res) {
  const id = userId(req, res);
  const recoveryId = caseId(req, res);
  if (!id || !recoveryId) return;
  try { return res.json({ success: true, data: await recoveryService.getCustomerRecoveryCase(recoveryId, id) }); } catch (error) { return sendError(res, error); }
}

async function approve(req, res) {
  const id = userId(req, res);
  const recoveryId = caseId(req, res);
  const alternativeId = Number(req.body?.alternativeId);
  const idempotencyKey = req.headers["x-idempotency-key"];
  if (!id || !recoveryId) return;
  if (!Number.isInteger(alternativeId) || alternativeId < 1 || typeof idempotencyKey !== "string" || !/^[a-zA-Z0-9._:-]{8,120}$/.test(idempotencyKey)) {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "A valid alternativeId and X-Idempotency-Key are required." });
  }
  try { return res.status(StatusCodes.ACCEPTED).json({ success: true, data: await recoveryService.approveRecoveryCase({ id: recoveryId, userId: id, alternativeId, idempotencyKey }) }); } catch (error) { return sendError(res, error); }
}

async function decline(req, res) {
  const id = userId(req, res);
  const recoveryId = caseId(req, res);
  const idempotencyKey = req.headers["x-idempotency-key"];
  if (!id || !recoveryId) return;
  if (typeof idempotencyKey !== "string" || !/^[a-zA-Z0-9._:-]{8,120}$/.test(idempotencyKey)) {
    return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: "A valid X-Idempotency-Key is required." });
  }
  try { return res.json({ success: true, data: await recoveryService.declineRecoveryCase({ id: recoveryId, userId: id, idempotencyKey }) }); } catch (error) { return sendError(res, error); }
}

module.exports = { list, detail, approve, decline };
