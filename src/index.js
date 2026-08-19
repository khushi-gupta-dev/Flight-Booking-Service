const express = require("express");

const { serverConfig, logger } = require("./config");
const apiRoutes = require("./routes");
const CRON = require('./utils/common/cron-jobs');
const app = express();

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.use("/api", apiRoutes);

// app.use("/bookingService/api", apiRoutes);
// console.log(process.env);
app.listen(serverConfig.PORT, () => {
  console.log(`Server is running on port ${serverConfig.PORT}`);
  CRON();
  // logger.info(`Server is running on port ${serverConfig.PORT}`, "root" , {})
});
