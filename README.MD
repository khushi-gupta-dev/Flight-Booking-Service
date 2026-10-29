# Flight Booking Service

Flight Booking Service (default port `4000`) owns passenger booking records, Razorpay payments, customer cancellation, admin booking review, and expiration of unpaid holds. Routes mount at `/api/v1` and are proxied under `/bookingService` by the gateway.

## Routes

- `POST /api/v1/bookings`: create a booking with `flightId`, `noOfSeats`, and one `passengerDetails` entry per seat. Requires a stable `x-idempotency-key` (8–120 safe characters); retrying the same key and payload returns the same booking, while reusing it for a different payload returns a conflict. The gateway supplies authenticated `x-user-id`; total cost is calculated from the flight price on the server.
- `POST /api/v1/bookings/payments/order`: create or reuse a Razorpay order for an owned `INITIATED` booking. Body: `{ "bookingId": 123 }`; requires `x-idempotency-key`. The amount is read from the booking record and returned in paise. This endpoint only creates the provider order; it does not mark the booking paid.
- `POST /api/v1/bookings/:id/payments/verify`: accept the Checkout order/payment/signature response, verify it with the stored order ID and Razorpay API, and confirm only a captured payment matching the saved amount and currency.
- `POST /webhooks/razorpay`: provider webhook receiver; validates `X-Razorpay-Signature` over the raw body and deduplicates `x-razorpay-event-id` before applying captured/failed state changes.
- `GET /api/v1/bookings`, `GET /api/v1/bookings/:id`: list or view only the signed-in customer's bookings.
- `POST /api/v1/bookings/:id/cancel`: cancel an eligible booking before departure and request seat restoration.
- `GET /api/v1/bookings/admin`: list all bookings; gateway restricts this route to admins.

Booking creation first persists a `pending` booking, then obtains the seat hold while locking that booking row. A failed or timed-out hold stays pending so retrying the same create key resumes the same request. Unpaid holds expire after five minutes; a scheduled job retries expiry releases every minute. Hold and release calls use stable operation IDs, and Flights Service records each inventory adjustment transactionally. Releases reference their hold, so a release arriving before a delayed hold prevents that hold from decrementing inventory later. Booking status changes lock the booking row, so concurrent expiry and cancellation requests cannot release the same seats twice. Cross-service updates remain a saga rather than one atomic database transaction. Verified payment queues email to the first passenger. Cancellation of a paid booking does not issue a refund. Apply the `20261029120000-add-booking-idempotency-key` migration before running the updated service.

Razorpay order creation uses `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and optional `RAZORPAY_CURRENCY` (defaults to `INR`) from the Booking Service environment. Apply the `20261030120000-create-payment-attempts` migration. The frontend opens Razorpay Checkout using the returned public key ID and server-created order; the secret remains in Booking Service.

Checkout verification stores the provider payment ID and captured/authorized/failed state. Apply `20261030130000-add-payment-verification-fields` after the payment-attempt migration. A captured payment arriving after a booking expires is recorded as `late_capture`; automatic refund handling is not implemented yet. The customer page submits Checkout's order/payment/signature response to the verification endpoint before displaying confirmation.

Webhook processing uses `RAZORPAY_WEBHOOK_SECRET`; configure the same Test Mode secret in the Razorpay Dashboard and Booking Service environment. Subscribe to `payment.captured` and `payment.failed`, and apply `20261030140000-create-payment-webhook-events`. The Gateway exposes the receiver at `/bookingService/webhooks/razorpay` and forwards the raw signed body.

## Run

Configure `PORT`, `FLIGHT_SERVICE`, the booking database, and RabbitMQ. Apply migrations with `npx sequelize db:migrate --config src/config/config.json --migrations-path src/migrations --models-path src/models`, then run `npm run dev`.
