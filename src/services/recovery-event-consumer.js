const amqp = require("amqplib");
const axios = require("axios");
const db = require("../models");
const { enums } = require("../utils/common");
const { logger, serverConfig } = require("../config");

const exchange = process.env.RABBITMQ_EVENTS_EXCHANGE || "skylink.events";
const queueName = process.env.RABBITMQ_RECOVERY_QUEUE || "booking-recovery-queue";
const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost";

function scoreAlternative(flight, originalFlight, disruption, seats) {
  const departure = new Date(flight.departureTime).getTime();
  const arrival = new Date(flight.arrivalTime).getTime();
  const originalArrival = new Date(originalFlight.arrivalTime).getTime();
  const window = Math.max(serverConfig.RECOVERY_SEARCH_WINDOW_HOURS, 1) * 60 * 60 * 1000;
  const departureQuality = Math.max(0, 1 - (departure - new Date(disruption.effectiveAt).getTime()) / window);
  const arrivalQuality = Math.max(0, 1 - Math.max(0, arrival - originalArrival) / window);
  const seatQuality = Math.min(1, Number(flight.totalSeats) / Math.max(seats * 3, 1));
  const priceQuality = Math.max(0, 1 - Number(flight.price) / Math.max(Number(originalFlight.price) * 2, 1));
  const score = (departureQuality * 40) + (arrivalQuality * 30) + (seatQuality * 20) + (priceQuality * 10);
  return Number(score.toFixed(4));
}

function explainAlternative(flight, originalFlight, seats) {
  const reasons = [];
  if (new Date(flight.arrivalTime) <= new Date(originalFlight.arrivalTime)) reasons.push("earliest comparable arrival");
  if (flight.departureAirportId === originalFlight.departureAirportId && flight.arrivalAirportId === originalFlight.arrivalAirportId) reasons.push("same route");
  if (Number(flight.totalSeats) >= seats) reasons.push(`seats available for all ${seats} passenger${seats === 1 ? "" : "s"}`);
  if (Number(flight.price) <= Number(originalFlight.price)) reasons.push("no higher fare");
  return reasons.join(", ") || "future flight with matching route and available seats";
}

async function generateAlternatives(recoveryCase, booking, disruption, correlationId) {
  const originalResponse = await axios.get(`${serverConfig.FLIGHT_SERVICE}/api/v1/flights/${booking.flightId}`);
  const originalFlight = originalResponse.data.data;
  const query = {
    trips: `${originalFlight.departureAirportId}-${originalFlight.arrivalAirportId}`,
    travellers: booking.noOfSeats,
  };
  const alternativesResponse = await axios.get(`${serverConfig.FLIGHT_SERVICE}/api/v1/flights`, { params: query });
  const cutoff = new Date(disruption.effectiveAt).getTime()
    + Math.max(serverConfig.RECOVERY_SEARCH_WINDOW_HOURS, 1) * 60 * 60 * 1000;
  const eligible = (alternativesResponse.data.data || [])
    .filter((flight) => Number(flight.id) !== Number(booking.flightId))
    .filter((flight) => Number(flight.totalSeats) >= Number(booking.noOfSeats))
    .filter((flight) => new Date(flight.departureTime).getTime() >= new Date(disruption.effectiveAt).getTime())
    .filter((flight) => new Date(flight.departureTime).getTime() <= cutoff)
    .filter((flight) => Number.isFinite(new Date(flight.departureTime).getTime()) && Number.isFinite(new Date(flight.arrivalTime).getTime()))
    .sort((left, right) => scoreAlternative(right, originalFlight, disruption, booking.noOfSeats) - scoreAlternative(left, originalFlight, disruption, booking.noOfSeats))
    .slice(0, 5);

  const transaction = await db.sequelize.transaction();
  try {
    const existing = await db.RecoveryAlternative.count({ where: { recoveryCaseId: recoveryCase.id }, transaction });
    if (!existing) {
      for (const flight of eligible) {
        await db.RecoveryAlternative.create({
          recoveryCaseId: recoveryCase.id,
          replacementFlightId: flight.id,
          departureTime: flight.departureTime,
          arrivalTime: flight.arrivalTime,
          price: flight.price,
          availableSeats: flight.totalSeats,
          score: scoreAlternative(flight, originalFlight, disruption, booking.noOfSeats),
          explanation: explainAlternative(flight, originalFlight, booking.noOfSeats),
        }, { transaction });
      }
    }
    await recoveryCase.update({ status: eligible.length ? "awaiting_approval" : "failed" }, { transaction });
    await db.RecoveryAuditEvent.create({
      aggregateType: "recovery_case",
      aggregateId: String(recoveryCase.id),
      eventType: eligible.length ? "alternatives_generated" : "alternatives_unavailable",
      actorType: "system",
      actorId: null,
      correlationId,
      payload: { count: eligible.length, replacementFlightIds: eligible.map((flight) => flight.id) },
    }, { transaction });
    await transaction.commit();
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
}

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
      const retryCases = await db.RecoveryCase.findAll({
        where: { disruptionId: disruption.id, status: ["awaiting_alternatives", "failed"] },
      });
      for (const recoveryCase of retryCases) {
        const booking = await db.Booking.findByPk(recoveryCase.bookingId);
        if (booking) await generateAlternatives(recoveryCase, booking, disruption, event.correlationId);
      }
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

    const cases = [];
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
      cases.push({ recoveryCase, booking });
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
    for (const { recoveryCase, booking } of cases) {
      await generateAlternatives(recoveryCase, booking, disruption, event.correlationId);
    }
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
