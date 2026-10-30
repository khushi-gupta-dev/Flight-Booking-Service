const amqp = require("amqplib");
const db = require("../models");
const { enums } = require("../utils/common");
const { logger } = require("../config");

const exchange = process.env.RABBITMQ_EVENTS_EXCHANGE || "skylink.events";
const queueName = process.env.RABBITMQ_RECOVERY_QUEUE || "booking-recovery-queue";
const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost";

async function handleDisruptionCreated(event) {
  const disruption = event.payload;
  const transaction = await db.sequelize.transaction();
  try {
    const processed = await db.ProcessedRecoveryEvent.findOne({
      where: { eventId: event.eventId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (processed) {
      await transaction.commit();
      return;
    }

    const bookings = await db.Booking.findAll({
      where: {
        flightId: disruption.flightId,
        status: enums.BOOKING_STATUS.BOOKED,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    for (const booking of bookings) {
      const [recoveryCase, created] = await db.RecoveryCase.findOrCreate({
        where: { disruptionId: disruption.id, bookingId: booking.id },
        defaults: {
          userId: booking.userId,
          status: "awaiting_alternatives",
        },
        transaction,
      });
      if (created) {
        await db.RecoveryAuditEvent.create({
          aggregateType: "recovery_case",
          aggregateId: String(recoveryCase.id),
          eventType: "passenger_identified",
          actorType: "system",
          actorId: null,
          correlationId: event.correlationId,
          payload: {
            disruptionId: disruption.id,
            bookingId: booking.id,
            flightId: disruption.flightId,
          },
        }, { transaction });
      }
    }

    await db.RecoveryAuditEvent.create({
      aggregateType: "disruption",
      aggregateId: String(disruption.id),
      eventType: "affected_passengers_identified",
      actorType: "system",
      actorId: null,
      correlationId: event.correlationId,
      payload: { affectedBookingCount: bookings.length },
    }, { transaction });

    await db.ProcessedRecoveryEvent.create({
      eventId: event.eventId,
      eventType: event.eventType,
      correlationId: event.correlationId,
    }, { transaction });
    await transaction.commit();
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

async function connectRecoveryConsumer() {
  const connection = await amqp.connect(rabbitUrl);
  const channel = await connection.createChannel();
  await channel.assertExchange(exchange, "topic", { durable: true });
  await channel.assertQueue(queueName, { durable: true });
  await channel.bindQueue(queueName, exchange, "disruption.created");
  await channel.prefetch(1);
  await channel.consume(queueName, async (message) => {
    if (!message) return;
    try {
      const event = JSON.parse(message.content.toString());
      if (event.eventType !== "disruption.created" || !event.eventId || !event.payload?.id) {
        logger.error("Recovery event rejected: invalid disruption event envelope");
        channel.nack(message, false, false);
        return;
      }
      await handleDisruptionCreated(event);
      channel.ack(message);
    } catch (error) {
      logger.error(`Recovery event processing failed: ${error.message}`);
      channel.nack(message, false, true);
    }
  });
  return connection;
}

module.exports = { connectRecoveryConsumer, handleDisruptionCreated };
