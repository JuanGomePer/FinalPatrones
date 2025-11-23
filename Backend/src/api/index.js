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

// ---------------------------------------------
// PROMETHEUS METRICS
// ---------------------------------------------

// Add "service=api" to every metric
client.register.setDefaultLabels({ service: "api" });

// Collect Node.js + process metrics
client.collectDefaultMetrics();

// Counter for total HTTP requests
const httpRequestCounter = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status"],
});

// Histogram for latency
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2],
});

// Middleware to record metrics
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();

  res.on("finish", () => {
    const route = req.route?.path || req.path;

    httpRequestCounter.inc({
      method: req.method,
      route,
      status: res.statusCode,
    });

    end({
      method: req.method,
      route,
      status: res.statusCode,
    });
  });

  next();
});

// Metrics endpoint
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

// ---------------------------------------------
// ROUTES
// ---------------------------------------------

app.use("/auth", authRoutes);
app.use("/rooms", roomsRoutes);

app.get("/", (req, res) => res.json({ status: "ok" }));

// ---------------------------------------------
// START SERVER
// ---------------------------------------------

async function start() {
  await initDb();
  app.listen(PORT, () => {
    console.log(`API running on port ${PORT}`);
  });
}

start();
