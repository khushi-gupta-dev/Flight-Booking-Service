# Flight Booking Service Documentation

Flight Booking Service owns passenger bookings, payment orchestration,
cancellation/refunds, unpaid-booking expiry, disruption recovery, and audit
history.

## Runtime

- Default port: `4000`
- Route prefix: `/api/v1`
- Gateway prefix: `/bookingService`
- Database: MySQL through Sequelize
- Start: `npm run dev`

## Routes

### Bookings and payments

- `POST /api/v1/bookings` — create an idempotent pending booking.
- `GET /api/v1/bookings` — list the signed-in customer's bookings.
- `GET /api/v1/bookings/:id` — view one owned booking.
- `POST /api/v1/bookings/:id/cancel` — request pre-departure cancellation.
- `GET /api/v1/bookings/admin` — admin booking review.
- `POST /api/v1/bookings/payments/order` — create/reuse a Razorpay order.
- `POST /api/v1/bookings/:id/payments/verify` — verify Checkout payment.
- `POST /webhooks/razorpay` — verify and process Razorpay webhooks.

Booking creation requires `x-idempotency-key` and one passenger detail per
seat. The server calculates cost from the flight price. Unpaid holds expire
after five minutes; the expiry job retries release work every minute.

Cancellation requests an 85% refund and retains 15% as the cancellation charge.
Late captures receive a full refund. Refunds use persisted attempts and
provider idempotency keys.

### Customer recovery

- `GET /api/v1/recovery-cases`
- `GET /api/v1/recovery-cases/:id`
- `POST /api/v1/recovery-cases/:id/approve`
- `POST /api/v1/recovery-cases/:id/decline`
- `POST /api/v1/recovery-cases/:id/retry`

The response includes the recovery audit timeline, original/current flight
details, alternatives, timing/fare differences, disruption context, approval
deadline, booking references, and compensation status.

### Admin recovery operations

- `GET /api/v1/recovery-operations`
- `GET /api/v1/recovery-operations/summary`
- `POST /api/v1/recovery-operations/:id/retry`
- `POST /api/v1/recovery-operations/:id/assign-alternative`
- `POST /api/v1/recovery-operations/:id/override`

Listing supports `status`, `disruptionId`, `from`, and `to`. Manual assignment
and override actions require an operational reason of at least five
characters. Admin actions reuse the same saga and audit records.

## Recovery event workflow

The consumer reads `disruption.created` from
`booking-recovery-queue` on the `skylink.events` exchange. It finds booked
passengers on the disrupted flight, creates one case per booking, and prevents
duplicates with `ProcessedRecoveryEvents`.

Alternatives are searched on the same route within
`RECOVERY_SEARCH_WINDOW_HOURS` (default `48`), with enough seats for the whole
booking. Up to five alternatives are ranked and stored as snapshots.

The rebooking saga:

1. Hold replacement seats.
2. Update the booking's flight.
3. Release original seats using a compensating operation.
4. Mark the case completed and append audit events.

Failures preserve the last step and remain retryable. Apply migrations in this
order:

1. `20261029120000-add-booking-idempotency-key`
2. `20261030120000-create-payment-attempts`
3. `20261030130000-add-payment-verification-fields`
4. `20261030140000-create-payment-webhook-events`
5. `20261030150000-create-refund-attempts`
6. `20261030160000-add-cancellation-requested-status`
7. `20261030170100-create-recovery-cases`
8. `20261030170200-create-recovery-alternatives`
9. `20261030170300-add-recovery-selection`
10. `20261030170400-create-rebooking-attempts`

## Configuration

```env
RABBITMQ_URL=amqp://localhost:5672
RABBITMQ_EVENTS_EXCHANGE=skylink.events
RABBITMQ_RECOVERY_QUEUE=booking-recovery-queue
RECOVERY_SEARCH_WINDOW_HOURS=48
RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
RAZORPAY_CURRENCY=INR
```

Booking and flight databases are separate. The workflow is retry-safe but is
not one distributed atomic transaction.
