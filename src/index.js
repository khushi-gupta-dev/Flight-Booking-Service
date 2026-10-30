const express = require("express");








const { serverConfig, logger , queue } = require("./config");
const apiRoutes = require("./routes");
const { bookingController } = require("./controllers");
const CRON = require('./utils/common/cron-jobs');
const { connectRecoveryConsumer } = require('./services/recovery-event-consumer');

const axios = require("axios");
const app = express();

app.post('/webhooks/razorpay', express.raw({ type: 'application/json', limit: '1mb' }), bookingController.receiveRazorpayWebhook);

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.use("/api", apiRoutes);

app.get("/", (req, res) => {
  res.send("Welcome to Flight Booking Service");
});


app.get("/callingFlightsService", async (req, res) => {
  const response = await axios.get("http://flights_service:3001")
  console.log("response from flight service", response.data);
  return res.json({message:response.data})
})

// app.use("/bookingService/api", apiRoutes);
// console.log(process.env);
app.listen(serverConfig.PORT, async() => {
  console.log(`Server is running on port ${serverConfig.PORT}`);
  CRON();
  try {
    await queue.connectQueue();
    logger.info("Connected to RabbitMQ queue noti-queue");
    await connectRecoveryConsumer();
    logger.info("Connected to RabbitMQ disruption recovery consumer");
  } catch (error) {
    logger.error(`RabbitMQ connection failed: ${error.message}`);
  }
});
