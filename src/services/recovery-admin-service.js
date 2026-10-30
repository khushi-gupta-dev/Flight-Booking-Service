const { Op } = require("sequelize");
const { StatusCodes } = require("http-status-codes");
const axios = require("axios");
const db = require("../models");
const AppError = require("../utils/errors/app-error");
const { serverConfig } = require("../config");
const recoveryService = require("./recovery-service");

async function withAdminDetails(recoveryCase) {
  const [audit, attempt] = await Promise.all([
    db.RecoveryAuditEvent.findAll({
      where: { aggregateType: "recovery_case", aggregateId: String(recoveryCase.id) },
      order: [["createdAt", "ASC"]],
    }),
    db.RebookingAttempt.findOne({ where: { recoveryCaseId: recoveryCase.id } }),
  ]);
  return { ...recoveryCase.toJSON(), audit, rebookingAttempt: attempt };
}

async function listOperations(query = {}) {
  const where = {};
  if (query.status) where.status = query.status;
  if (query.disruptionId) where.disruptionId = Number(query.disruptionId);
  if (query.from || query.to) {
    where.createdAt = {};
    if (query.from) where.createdAt[Op.gte] = new Date(query.from);
    if (query.to) where.createdAt[Op.lte] = new Date(`${query.to}T23:59:59.999Z`);
  }
  const rows = await db.RecoveryCase.findAll({
    where,
    include: [
      { model: db.RecoveryAlternative, as: "alternatives", required: false },
      { model: db.Booking, as: "booking", required: true },
    ],
    order: [["createdAt", "DESC"]],
  });
  return Promise.all(rows.map(withAdminDetails));
}

async function getSummary(query = {}) {
  const cases = await listOperations(query);
  return {
    affectedPassengers: cases.reduce((total, item) => total + Number(item.booking?.noOfSeats || 0), 0),
    recoveryCases: cases.length,
    awaitingApproval: cases.filter((item) => item.status === "awaiting_approval").length,
    successfulRebookings: cases.filter((item) => item.status === "completed").length,
    failedRebookings: cases.filter((item) => item.status === "failed").length,
    activeRebookings: cases.filter((item) => item.status === "rebooking").length,
  };
}

async function assignAlternative({ id, flightId, adminId, reason }) {
  if (!reason || reason.trim().length < 5) throw new AppError("A reason of at least 5 characters is required.", StatusCodes.BAD_REQUEST);
  const recoveryCase = await db.RecoveryCase.findByPk(id);
  if (!recoveryCase) throw new AppError("Recovery case not found.", StatusCodes.NOT_FOUND);
  if (!["awaiting_alternatives", "failed", "awaiting_approval"].includes(recoveryCase.status)) {
    throw new AppError("A manual alternative cannot be assigned in this case state.", StatusCodes.CONFLICT);
  }
  const booking = await db.Booking.findByPk(recoveryCase.bookingId);
  const response = await axios.get(`${serverConfig.FLIGHT_SERVICE}/api/v1/flights/${flightId}`);
  const flight = response.data.data;
  if (!flight || Number(flight.totalSeats) < Number(booking.noOfSeats) || new Date(flight.departureTime) <= new Date()) {
    throw new AppError("The selected flight is unavailable for this booking.", StatusCodes.CONFLICT);
  }
  const [alternative] = await db.RecoveryAlternative.findOrCreate({
    where: { recoveryCaseId: id, replacementFlightId: flight.id },
    defaults: {
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      price: flight.price,
      availableSeats: flight.totalSeats,
      score: 100,
      explanation: "Manually assigned by an administrator.",
    },
  });
  await recoveryCase.update({ status: "awaiting_approval" });
  await db.RecoveryAuditEvent.create({
    aggregateType: "recovery_case",
    aggregateId: String(id),
    eventType: "alternative_manually_assigned",
    actorType: "admin",
    actorId: String(adminId),
    correlationId: `admin-alternative-${id}-${Date.now()}`,
    payload: { alternativeId: alternative.id, replacementFlightId: flight.id, reason: reason.trim() },
  });
  return withAdminDetails(await db.RecoveryCase.findByPk(id, {
    include: [
      { model: db.RecoveryAlternative, as: "alternatives", required: false },
      { model: db.Booking, as: "booking", required: true },
    ],
  }));
}

async function overrideCase({ id, adminId, action, alternativeId, reason }) {
  if (!reason || reason.trim().length < 5) throw new AppError("An override reason of at least 5 characters is required.", StatusCodes.BAD_REQUEST);
  const recoveryCase = await db.RecoveryCase.findByPk(id);
  if (!recoveryCase) throw new AppError("Recovery case not found.", StatusCodes.NOT_FOUND);
  if (action === "close") {
    await recoveryCase.update({ status: "declined" });
  } else if (action === "approve_rebooking") {
    const alternative = await db.RecoveryAlternative.findOne({ where: { id: alternativeId, recoveryCaseId: id, status: { [Op.in]: ["available", "selected"] } } });
    if (!alternative) throw new AppError("Choose a valid available alternative.", StatusCodes.BAD_REQUEST);
    await recoveryCase.update({ selectedAlternativeId: alternative.id, status: "rebooking" });
    await alternative.update({ status: "selected" });
    await db.RecoveryAuditEvent.create({
      aggregateType: "recovery_case",
      aggregateId: String(id),
      eventType: "alternative_approved",
      actorType: "admin",
      actorId: String(adminId),
      correlationId: `admin-override-${id}-${Date.now()}`,
      payload: { alternativeId: alternative.id, reason: reason.trim(), override: true },
    });
    return recoveryService.adminRetryRecoveryCase({ id, adminId });
  } else {
    throw new AppError("Unsupported operational override.", StatusCodes.BAD_REQUEST);
  }
  await db.RecoveryAuditEvent.create({
    aggregateType: "recovery_case",
    aggregateId: String(id),
    eventType: "operational_override",
    actorType: "admin",
    actorId: String(adminId),
    correlationId: `admin-override-${id}-${Date.now()}`,
    payload: { action, reason: reason.trim() },
  });
  return withAdminDetails(await db.RecoveryCase.findByPk(id, {
    include: [
      { model: db.RecoveryAlternative, as: "alternatives", required: false },
      { model: db.Booking, as: "booking", required: true },
    ],
  }));
}

module.exports = { listOperations, getSummary, assignAlternative, overrideCase };
