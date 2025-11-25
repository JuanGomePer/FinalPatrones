// otel.js
const { NodeSDK } = require("@opentelemetry/sdk-node");
const {
  OTLPTraceExporter,
} = require("@opentelemetry/exporter-trace-otlp-grpc");
const {
  getNodeAutoInstrumentations,
} = require("@opentelemetry/auto-instrumentations-node");

const exporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://jaeger:4317",
});

console.log(
  `Starting OpenTelemetry for service: ${process.env.OTEL_SERVICE_NAME}`
);

const sdk = new NodeSDK({
  traceExporter: exporter,
  instrumentations: [getNodeAutoInstrumentations()],
});

// Just call start() without .then() - it might be synchronous in your version
sdk.start();

console.log("✅ OpenTelemetry SDK initialized");

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down OpenTelemetry...");
  sdk
    .shutdown()
    .then(() => {
      console.log("✅ OpenTelemetry SDK shutdown complete");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Error shutting down OpenTelemetry SDK:", error);
      process.exit(1);
    });
});

process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down OpenTelemetry...");
  sdk
    .shutdown()
    .then(() => {
      console.log("✅ OpenTelemetry SDK shutdown complete");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Error shutting down OpenTelemetry SDK:", error);
      process.exit(1);
    });
});
