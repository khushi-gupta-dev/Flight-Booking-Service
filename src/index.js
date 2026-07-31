const express = require("express");




const {serverConfig , logger}  = require("./config")
const apiRoutes = require("./routes");
const app = express();

app.use("/api", apiRoutes);
// console.log(process.env);
app.listen(serverConfig.PORT, () => {
    console.log(`Server is running on port ${serverConfig.PORT}`);
    // logger.info(`Server is running on port ${serverConfig.PORT}`, "root" , {})
});

