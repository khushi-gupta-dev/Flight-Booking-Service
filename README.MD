# Flight Booking Service

Owns passenger bookings, demo payment confirmation, customer cancellation, admin booking review, and expiration of unpaid holds. Routes are mounted at `/api/v1` and proxied by the gateway under `/bookingService`.

## Routes

- `POST /api/v1/bookings` creates a booking from `flightId`, `noOfSeats`, and matching `passengerDetails`; the service calculates the total.
- `POST /api/v1/bookings/payments` confirms demo payment. Requires `x-idempotency-key`; ownership comes from the gateway's `x-user-id`.
- `GET /api/v1/bookings`, `GET /:id`, and `POST /:id/cancel` are customer routes.
- `GET /api/v1/bookings/admin` lists bookings; gateway restricts it to admins.

Bookings expire after five minutes if unpaid. A scheduled job restores held seats through Flights Service. Confirmation messages are sent to RabbitMQ for Notification Service email delivery. Payment simulation is not a real payment integration.

## Run

Set `PORT`, `FLIGHT_SERVICE`, database configuration, and RabbitMQ availability. Apply migrations with `npx sequelize db:migrate --config src/config/config.json --migrations-path src/migrations --models-path src/models`, then run `npm run dev` (default port 4000).
