const amqp = require("amqplib");

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost";

async function connect() {
  const conn = await amqp.connect(RABBITMQ_URL);
  const channel = await conn.createChannel();
  // Exchange chat (topic) para mensajes
  await channel.assertExchange("chat", "topic", { durable: true });
  return { conn, channel };
}

module.exports = { connect };
