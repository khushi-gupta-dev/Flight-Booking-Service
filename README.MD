# Flight Booking Service

Flight Booking Service (default port `4000`) owns passenger booking records, demo payment, customer cancellation, admin booking review, and expiration of unpaid holds. Routes mount at `/api/v1` and are proxied under `/bookingService` by the gateway.

## Routes

- `POST /api/v1/bookings`: create a booking with `flightId`, `noOfSeats`, and one `passengerDetails` entry per seat. Requires a stable `x-idempotency-key` (8–120 safe characters); retrying the same key and payload returns the same booking, while reusing it for a different payload returns a conflict. The gateway supplies authenticated `x-user-id`; total cost is calculated from the flight price on the server.
- `POST /api/v1/bookings/payments`: confirm demo payment; requires `x-idempotency-key`. This is not a real payment provider. Idempotency keys are cached in memory; booking status is the persisted duplicate-confirmation guard.
- `GET /api/v1/bookings`, `GET /api/v1/bookings/:id`: list or view only the signed-in customer's bookings.
- `POST /api/v1/bookings/:id/cancel`: cancel an eligible booking before departure and request seat restoration.
- `GET /api/v1/bookings/admin`: list all bookings; gateway restricts this route to admins.

Booking creation first persists a `pending` booking, then obtains the seat hold while locking that booking row. A failed or timed-out hold stays pending so retrying the same create key resumes the same request. Unpaid holds expire after five minutes; a scheduled job retries expiry releases every minute. Hold and release calls use stable operation IDs, and Flights Service records each inventory adjustment transactionally. Releases reference their hold, so a release arriving before a delayed hold prevents that hold from decrementing inventory later. Booking status changes lock the booking row, so concurrent expiry and cancellation requests cannot release the same seats twice. Cross-service updates remain a saga rather than one atomic database transaction. Successful demo payment queues email to the first passenger. Cancellation of a paid booking does not issue a refund. Apply the `20261029120000-add-booking-idempotency-key` migration before running the updated service. Payment idempotency keys are still cached in memory.

## Run

Configure `PORT`, `FLIGHT_SERVICE`, the booking database, and RabbitMQ. Apply migrations with `npx sequelize db:migrate --config src/config/config.json --migrations-path src/migrations --models-path src/models`, then run `npm run dev`.
