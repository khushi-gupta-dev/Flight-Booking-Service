const {StatusCodes} = require("http-status-codes");

const info = (req, res) => {
    return res.status(StatusCodes.OK).json({     // res object has a status function which sets the status code  and this status function returns the same response object and  that's why on that res object we can chain the json function to it , and it also returns same res object
        success: true,
        message: "api is live",
        error: {},
        data: {},
    })
}

module.exports = {
    info
}