require("../../otel"); // before anything else

require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const client = require("prom-client");

const authRoutes = require("./routes/auth");
const roomsRoutes = require("./routes/rooms");
const initDb = require("../db/init");

const PORT = process.env.API_PORT || 3000;
const app = express();

app.use(cors());
app.use(bodyParser.json());

// Register Prometheus default metrics
client.collectDefaultMetrics();

// Metrics endpoint
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

// Routes
app.use("/auth", authRoutes);
app.use("/rooms", roomsRoutes);

app.get("/", (req, res) => res.json({ status: "ok" }));

async function start() {
  await initDb();

  app.listen(PORT, () => {
    console.log(`API running on port ${PORT}`);
  });
}

start();
