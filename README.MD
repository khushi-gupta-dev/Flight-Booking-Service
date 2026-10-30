# Flight Booking Service

Flight Booking Service (default port `4000`) owns passenger booking records, Razorpay payments, customer cancellation, admin booking review, and expiration of unpaid holds. Routes mount at `/api/v1` and are proxied under `/bookingService` by the gateway. The frontend reaches this service only through the gateway; the AI assistant cannot create or modify bookings.

## Routes

- `POST /api/v1/bookings`: create a booking with `flightId`, `noOfSeats`, and one `passengerDetails` entry per seat. Requires a stable `x-idempotency-key` (8–120 safe characters); retrying the same key and payload returns the same booking, while reusing it for a different payload returns a conflict. The gateway supplies authenticated `x-user-id`; total cost is calculated from the flight price on the server.
- `POST /api/v1/bookings/payments/order`: create or reuse a Razorpay order for an owned `INITIATED` booking. Body: `{ "bookingId": 123 }`; requires `x-idempotency-key`. The amount is read from the booking record and returned in paise. This endpoint only creates the provider order; it does not mark the booking paid.
- `POST /api/v1/bookings/:id/payments/verify`: accept the Checkout order/payment/signature response, verify it with the stored order ID and Razorpay API, and confirm only a captured payment matching the saved amount and currency.
- `POST /webhooks/razorpay`: provider webhook receiver; validates `X-Razorpay-Signature` over the raw body and deduplicates `x-razorpay-event-id` before applying captured/failed state changes.
- `GET /api/v1/bookings`, `GET /api/v1/bookings/:id`: list or view only the signed-in customer's bookings.
- `POST /api/v1/bookings/:id/cancel`: request cancellation before departure. Paid bookings enter `cancellation_requested`, request an 85% Razorpay refund (15% cancellation charge), and become `cancelled` with seats released after Razorpay accepts the refund. Repeat the request to resume a failed or pending cancellation.
- `GET /api/v1/bookings/admin`: list all bookings; gateway restricts this route to admins.

Booking creation first persists a `pending` booking, then obtains the seat hold while locking that booking row. A failed or timed-out hold stays pending so retrying the same create key resumes the same request. Unpaid holds expire after five minutes; a scheduled job retries expiry releases every minute. Hold and release calls use stable operation IDs, and Flights Service records each inventory adjustment transactionally. Releases reference their hold, so a release arriving before a delayed hold prevents that hold from decrementing inventory later. Booking status changes lock the booking row, so concurrent expiry and cancellation requests cannot release the same seats twice. Cross-service updates remain a saga rather than one atomic database transaction. Verified payment queues email to the first passenger. Apply the `20261029120000-add-booking-idempotency-key` migration before running the updated service.

The Phase 1 recovery consumer listens to the durable `booking-recovery-queue`
queue on the `skylink.events` RabbitMQ exchange. For each idempotent
`disruption.created` event, it finds `booked` bookings for the disrupted
flight, creates one `RecoveryCase` per booking with
`awaiting_alternatives` status, and appends recovery audit events. Duplicate
events are acknowledged without creating duplicate cases. Apply migration
`20261030170100-create-recovery-cases` before starting the consumer. Set
`RABBITMQ_EVENTS_EXCHANGE` or `RABBITMQ_RECOVERY_QUEUE` only when using
non-default broker names.

After detection, the consumer queries Flights Service for future flights on
the same route with enough seats for the complete booking. It ranks up to five
results using departure timing, arrival timing, seat availability, and fare,
then stores a snapshot in `RecoveryAlternatives` with an explanation shown to
the passenger. Cases with recommendations move to `awaiting_approval`;
cases without eligible flights move to `failed` and can be regenerated when
the original event is redelivered. Configure
`RECOVERY_SEARCH_WINDOW_HOURS` (default `48`) to change the search window.
Apply migration `20261030170200-create-recovery-alternatives`.

Customer recovery APIs are available through the Gateway at
`GET /bookingService/api/v1/recovery-cases`,
`GET /bookingService/api/v1/recovery-cases/:id`,
`POST /bookingService/api/v1/recovery-cases/:id/approve`, and
`POST /bookingService/api/v1/recovery-cases/:id/decline`. The Gateway
forwards only the verified customer ID. Approval locks the case, validates
ownership and the selected alternative, records an idempotent approval audit
event, and moves the case to `rebooking` for Part 5. Declining moves it to
`declined`; neither action changes seats or the booking until the rebooking
saga runs. Apply migration `20261030170300-add-recovery-selection`.

After approval, the rebooking saga uses stable inventory operation IDs. It
holds all replacement seats first, updates the booking flight, then releases
the original seats with a compensating release operation. Progress is stored
in `RebookingAttempts`; a timeout or service failure leaves the last completed
step available for retry through
`POST /bookingService/api/v1/recovery-cases/:id/retry`. Apply migration
`20261030170400-create-rebooking-attempts`. A completed recovery case exposes
its attempt status and audit timeline to the customer.

Razorpay order creation uses `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and optional `RAZORPAY_CURRENCY` (defaults to `INR`) from the Booking Service environment. Apply the `20261030120000-create-payment-attempts` migration. The frontend opens Razorpay Checkout using the returned public key ID and server-created order; the secret remains in Booking Service.

Checkout verification stores the provider payment ID and captured/authorized/failed state. Apply `20261030130000-add-payment-verification-fields` after the payment-attempt migration. A captured payment arriving after a booking expires is recorded as `late_capture` and queued for a full refund. The customer page submits Checkout's order/payment/signature response to the verification endpoint before displaying confirmation.

Webhook processing uses `RAZORPAY_WEBHOOK_SECRET`; configure the same Test Mode secret in the Razorpay Dashboard and Booking Service environment. Subscribe to `payment.captured`, `payment.failed`, `refund.created`, `refund.processed`, and `refund.failed`, and apply `20261030140000-create-payment-webhook-events`. The Gateway exposes the receiver at `/bookingService/webhooks/razorpay` and forwards the raw signed body.

`RefundAttempts` stores refund requests separately from payment attempts, including the provider refund ID, amount in paise, reason, idempotency key, and queued/pending/processed/failed state. Apply `20261030150000-create-refund-attempts` and `20261030160000-add-cancellation-requested-status` before running cancellation or late-capture refunds. Cancellation refunds are 85% of the captured amount; late-capture refunds remain full. Refund creation uses Razorpay's `X-Refund-Idempotency` header; retries reuse the stored key, and a new attempt/key is created after a definitive failure. A paid booking stays `cancellation_requested` while a refund is rejected or pending; after Razorpay accepts the partial refund and seats are released, it becomes `cancelled`. Existing booked rows with failed cancellation refunds are moved to `cancellation_requested` by the migration.

Paid cancellation requests an 85% refund and releases seats after Razorpay accepts the request. A scheduled job retries queued refunds, including full late-capture refunds, using the same provider idempotency key. Refund status is included in the customer's booking detail; a definitively failed cancellation refund can be retried while the booking is `cancellation_requested`. For a definitive Razorpay 4xx rejection, the API returns the provider's sanitized description; verify the payment/refund in Razorpay before retrying.

## Run

Configure `PORT` (default `4000`), `FLIGHT_SERVICE` (default `http://localhost:3001`), the booking database, and RabbitMQ. Apply migrations with `npx sequelize db:migrate --config src/config/config.json --migrations-path src/migrations --models-path src/models`, then run `npm run dev`. The service must be able to reach Flights Service, RabbitMQ, and Razorpay Test Mode for the complete booking flow.
