# Flight Booking Service

Flight Booking Service (default port `4000`) owns passenger booking records, demo payment, customer cancellation, admin booking review, and expiration of unpaid holds. Routes mount at `/api/v1` and are proxied under `/bookingService` by the gateway.

## Routes

- `POST /api/v1/bookings`: create a booking with `flightId`, `noOfSeats`, and one `passengerDetails` entry per seat. The gateway supplies authenticated `x-user-id`; total cost is calculated from the flight price on the server.
- `POST /api/v1/bookings/payments`: confirm demo payment; requires `x-idempotency-key`. This is not a real payment provider. Idempotency keys are cached in memory; booking status is the persisted duplicate-confirmation guard.
- `GET /api/v1/bookings`, `GET /api/v1/bookings/:id`: list or view only the signed-in customer's bookings.
- `POST /api/v1/bookings/:id/cancel`: cancel an eligible booking before departure and request seat restoration.
- `GET /api/v1/bookings/admin`: list all bookings; gateway restricts this route to admins.

The booking service asks Flights Service to hold seats at creation. Unpaid holds expire after five minutes; a scheduled job requests seat restoration. Successful demo payment queues email to the first passenger. Cancellation of a paid booking does not issue a refund. Booking and inventory changes span services and are not one atomic transaction.

## Run

Configure `PORT`, `FLIGHT_SERVICE`, the booking database, and RabbitMQ. Apply migrations with `npx sequelize db:migrate --config src/config/config.json --migrations-path src/migrations --models-path src/models`, then run `npm run dev`.
