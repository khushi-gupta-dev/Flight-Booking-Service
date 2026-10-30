const { StatusCodes } = require("http-status-codes");
const axios = require("axios");
const db = require("../models");
const AppError = require("../utils/errors/app-error");
const { serverConfig } = require("../config");

function assertCaseOwner(recoveryCase, userId) {
  if (!recoveryCase || Number(recoveryCase.userId) !== Number(userId)) {
    throw new AppError("Recovery case not found.", StatusCodes.NOT_FOUND);
  }
}

async function getCustomerRecoveryCases(userId) {
  const cases = await db.RecoveryCase.findAll({
    where: { userId },
    include: [
      { model: db.RecoveryAlternative, as: "alternatives", required: false },
      { model: db.Booking, as: "booking", required: true },
    ],
    order: [["createdAt", "DESC"]],
  });
  return Promise.all(cases.map(withRecoveryHistory));
}

async function getCustomerRecoveryCase(id, userId) {
  const recoveryCase = await db.RecoveryCase.findByPk(id, {
    include: [
      { model: db.RecoveryAlternative, as: "alternatives", required: false },
      { model: db.Booking, as: "booking", required: true },
    ],
  });
  assertCaseOwner(recoveryCase, userId);
  return withRecoveryHistory(recoveryCase);
}

async function getRecoveryCaseForAdmin(id) {
  const recoveryCase = await db.RecoveryCase.findByPk(id, {
    include: [
      { model: db.RecoveryAlternative, as: "alternatives", required: false },
      { model: db.Booking, as: "booking", required: true },
    ],
  });
  return withRecoveryHistory(recoveryCase);
}

async function withRecoveryHistory(recoveryCase) {
  const audit = await db.RecoveryAuditEvent.findAll({
    where: { aggregateType: "recovery_case", aggregateId: String(recoveryCase.id) },
    order: [["createdAt", "ASC"]],
  });
  const attempt = await db.RebookingAttempt.findOne({ where: { recoveryCaseId: recoveryCase.id } });
  return { ...recoveryCase.toJSON(), audit, rebookingAttempt: attempt };
}

async function saveAttempt(id, data) {
  const attempt = await db.RebookingAttempt.findOne({ where: { recoveryCaseId: id } });
  if (!attempt) throw new AppError("Rebooking attempt was not found.", StatusCodes.CONFLICT);
  await attempt.update(data);
  return attempt;
}

async function markSagaFailure(id, userId, error) {
  const message = String(error.message || "Rebooking step failed").slice(0, 500);
  await saveAttempt(id, { status: "failed", errorMessage: message });
  await db.RecoveryCase.update({ status: "failed" }, { where: { id } });
  await db.RecoveryAuditEvent.create({
    aggregateType: "recovery_case",
    aggregateId: String(id),
    eventType: "rebooking_failed",
    actorType: "system",
    actorId: String(userId),
    correlationId: `rebooking-${id}`,
    payload: { message },
  });
}

async function runRebooking({ id, userId, allowAdmin = false }) {
  const transaction = await db.sequelize.transaction();
  let recoveryCase;
  let booking;
  let alternative;
  let attempt;
  try {
    recoveryCase = await db.RecoveryCase.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!allowAdmin) assertCaseOwner(recoveryCase, userId);
    booking = await db.Booking.findByPk(recoveryCase.bookingId, { transaction, lock: transaction.LOCK.UPDATE });
    alternative = await db.RecoveryAlternative.findByPk(recoveryCase.selectedAlternativeId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!booking || !alternative) throw new AppError("The selected recovery data is unavailable.", StatusCodes.CONFLICT);
    [attempt] = await db.RebookingAttempt.findOrCreate({
      where: { recoveryCaseId: id },
      defaults: {
        idempotencyKey: `rebooking-case-${id}`,
        status: "created",
        replacementHoldOperationId: `recovery-hold-${id}`,
        oldSeatReleaseOperationId: `recovery-release-${id}`,
        previousFlightId: booking.flightId,
        replacementFlightId: alternative.replacementFlightId,
      },
      transaction,
    });
    await transaction.commit();

    if (attempt.status === "completed") return allowAdmin ? getRecoveryCaseForAdmin(id) : getCustomerRecoveryCase(id, userId);
    if (["created", "failed", "replacement_hold_pending"].includes(attempt.status)) {
      await saveAttempt(id, { status: "replacement_hold_pending", errorMessage: null, lastStep: "replacement_hold" });
      await axios.patch(`${serverConfig.FLIGHT_SERVICE}/api/v1/flights/${attempt.replacementFlightId}/seats`, {
        seats: booking.noOfSeats,
        operationId: attempt.replacementHoldOperationId,
      });
      await saveAttempt(id, { status: "replacement_held", lastStep: "replacement_hold" });
    }

    attempt = await db.RebookingAttempt.findOne({ where: { recoveryCaseId: id } });
    if (attempt.status === "replacement_held") {
      const currentBooking = await db.Booking.findByPk(booking.id);
      if (Number(currentBooking.flightId) === Number(attempt.previousFlightId)) {
        await db.Booking.update({ flightId: attempt.replacementFlightId }, { where: { id: booking.id } });
      }
      await saveAttempt(id, { status: "booking_updated", lastStep: "booking_update" });
      await db.RecoveryAuditEvent.create({
        aggregateType: "recovery_case",
        aggregateId: String(id),
        eventType: "booking_rebooked",
        actorType: "system",
        actorId: String(userId),
        correlationId: `rebooking-${id}`,
        payload: { bookingId: booking.id, previousFlightId: attempt.previousFlightId, replacementFlightId: attempt.replacementFlightId },
      });
    }

    attempt = await db.RebookingAttempt.findOne({ where: { recoveryCaseId: id } });
    if (["booking_updated", "old_seat_release_pending"].includes(attempt.status)) {
      await saveAttempt(id, { status: "old_seat_release_pending", lastStep: "old_seat_release" });
      await axios.patch(`${serverConfig.FLIGHT_SERVICE}/api/v1/flights/${attempt.previousFlightId}/seats`, {
        seats: booking.noOfSeats,
        dec: 0,
        operationId: attempt.oldSeatReleaseOperationId,
        compensatesOperationId: attempt.replacementHoldOperationId,
      });
      await saveAttempt(id, { status: "completed", lastStep: "completed", errorMessage: null });
      await db.RecoveryCase.update({ status: "completed" }, { where: { id } });
      await db.RecoveryAuditEvent.create({
        aggregateType: "recovery_case",
        aggregateId: String(id),
        eventType: "old_seat_released",
        actorType: "system",
        actorId: String(userId),
        correlationId: `rebooking-${id}`,
        payload: { previousFlightId: attempt.previousFlightId },
      });
    }
    return allowAdmin ? getRecoveryCaseForAdmin(id) : getCustomerRecoveryCase(id, userId);
  } catch (error) {
    if (transaction && !transaction.finished) await transaction.rollback();
    await markSagaFailure(id, userId, error);
    throw new AppError("Rebooking could not complete. The case is saved for a safe retry.", StatusCodes.SERVICE_UNAVAILABLE);
  }
}

async function approveRecoveryCase({ id, userId, alternativeId, idempotencyKey }) {
  const transaction = await db.sequelize.transaction();
  try {
    const recoveryCase = await db.RecoveryCase.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    assertCaseOwner(recoveryCase, userId);
    const priorApproval = await db.RecoveryAuditEvent.findOne({
      where: { aggregateType: "recovery_case", aggregateId: String(id), eventType: "alternative_approved", correlationId: idempotencyKey },
      transaction,
    });
    if (priorApproval) {
      await transaction.commit();
      return runRebooking({ id, userId });
    }

    if (recoveryCase.status !== "awaiting_approval") {
      throw new AppError("This recovery case is no longer awaiting approval.", StatusCodes.CONFLICT);
    }
    const alternative = await db.RecoveryAlternative.findOne({
      where: { id: alternativeId, recoveryCaseId: id, status: "available" },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!alternative) throw new AppError("That recovery option is no longer available.", StatusCodes.CONFLICT);
    if (new Date(alternative.departureTime) <= new Date()) {
      await alternative.update({ status: "expired" }, { transaction });
      throw new AppError("That recovery option has expired.", StatusCodes.CONFLICT);
    }

    await recoveryCase.update({ selectedAlternativeId: alternative.id, status: "rebooking" }, { transaction });
    await alternative.update({ status: "selected" }, { transaction });
    await db.RecoveryAuditEvent.create({
      aggregateType: "recovery_case",
      aggregateId: String(recoveryCase.id),
      eventType: "alternative_approved",
      actorType: "customer",
      actorId: String(userId),
      correlationId: idempotencyKey,
      payload: { alternativeId: alternative.id },
    }, { transaction });
    await transaction.commit();
    return runRebooking({ id, userId });
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

async function retryRecoveryCase({ id, userId }) {
  const recoveryCase = await db.RecoveryCase.findByPk(id);
  assertCaseOwner(recoveryCase, userId);
  if (!["failed", "rebooking"].includes(recoveryCase.status)) {
    throw new AppError("This recovery case is not ready for rebooking retry.", StatusCodes.CONFLICT);
  }

  await db.RecoveryCase.update({ status: "rebooking" }, { where: { id } });
  return runRebooking({ id, userId });
}

async function adminRetryRecoveryCase({ id, adminId }) {
  const recoveryCase = await db.RecoveryCase.findByPk(id);
  if (!recoveryCase) throw new AppError("Recovery case not found.", StatusCodes.NOT_FOUND);
  if (!["failed", "rebooking"].includes(recoveryCase.status)) {
    throw new AppError("This recovery case is not ready for rebooking retry.", StatusCodes.CONFLICT);
  }
  await db.RecoveryCase.update({ status: "rebooking" }, { where: { id } });
  return runRebooking({ id, userId: adminId, allowAdmin: true });
}

async function declineRecoveryCase({ id, userId, idempotencyKey }) {
  const transaction = await db.sequelize.transaction();
  try {
    const recoveryCase = await db.RecoveryCase.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    assertCaseOwner(recoveryCase, userId);
    const priorDecline = await db.RecoveryAuditEvent.findOne({
      where: { aggregateType: "recovery_case", aggregateId: String(id), eventType: "alternative_declined", correlationId: idempotencyKey },
      transaction,
    });
    if (priorDecline) {
      await transaction.commit();
      return getCustomerRecoveryCase(id, userId);
    }
    if (recoveryCase.status !== "awaiting_approval") {
      throw new AppError("This recovery case is no longer awaiting approval.", StatusCodes.CONFLICT);
    }
    await recoveryCase.update({ status: "declined" }, { transaction });
    await db.RecoveryAuditEvent.create({
      aggregateType: "recovery_case",
      aggregateId: String(recoveryCase.id),
      eventType: "alternative_declined",
      actorType: "customer",
      actorId: String(userId),
      correlationId: idempotencyKey,
      payload: {},
    }, { transaction });
    await transaction.commit();
    return getCustomerRecoveryCase(id, userId);
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

module.exports = { getCustomerRecoveryCases, getCustomerRecoveryCase, approveRecoveryCase, declineRecoveryCase, retryRecoveryCase, adminRetryRecoveryCase };
