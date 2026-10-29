
const amqplib = require("amqplib");


let channel , connection;

async function connectQueue(){
    try{
         connection = await amqplib.connect(process.env.RABBITMQ_URL || "amqp://localhost");

         channel = await connection.createChannel();

        await channel.assertQueue("noti-queue" );



 
    } catch (error) {
        channel = undefined;
        connection = undefined;
        throw error;
    }
}


async function sendData(data){
    try{
await channel.sendToQueue("noti-queue", Buffer.from(JSON.stringify(data)));


    }
    catch(error){
        console.error(error);
    }
}

module.exports = {
    connectQueue , 
    sendData
};
