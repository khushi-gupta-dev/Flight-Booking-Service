const { StatusCodes } = require("http-status-codes");
const db = require("../models");
const AppError = require("../utils/errors/app-error");

function assertCaseOwner(recoveryCase, userId) {
  if (!recoveryCase || Number(recoveryCase.userId) !== Number(userId)) {
    throw new AppError("Recovery case not found.", StatusCodes.NOT_FOUND);
  }
}

async function getCustomerRecoveryCases(userId) {
  return db.RecoveryCase.findAll({
    where: { userId },
    include: [
      { model: db.RecoveryAlternative, as: "alternatives", required: false },
      { model: db.Booking, as: "booking", required: true },
    ],
    order: [["createdAt", "DESC"]],
  });
}

async function getCustomerRecoveryCase(id, userId) {
  const recoveryCase = await db.RecoveryCase.findByPk(id, {
    include: [
      { model: db.RecoveryAlternative, as: "alternatives", required: false },
      { model: db.Booking, as: "booking", required: true },
    ],
  });
  assertCaseOwner(recoveryCase, userId);
  return recoveryCase;
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
      return getCustomerRecoveryCase(id, userId);
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
    return getCustomerRecoveryCase(id, userId);
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
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

module.exports = { getCustomerRecoveryCases, getCustomerRecoveryCase, approveRecoveryCase, declineRecoveryCase };
