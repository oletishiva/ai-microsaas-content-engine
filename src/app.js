/**
 * src/app.js
 * -----------
 * Express application entry point for AI Content Engine.
 *
 * Responsibilities:
 *  - Load environment variables (must be first)
 *  - Create and configure the Express app
 *  - Mount API routes
 *  - Start the HTTP server
 *
 * Workshop tip:
 *  Keep app.js thin. Business logic belongs in /services and /routes,
 *  not here. This file is just the "wiring" layer.
 */

// ── 1. Load environment variables from .env ───────────────────────────────
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const { validateRequiredKeys } = require("../config/apiKeys");
const { OUTPUT_DIR, MEDIA_DIR } = require("../config/paths");
const logger = require("../utils/logger");

// Validate API keys at startup (fail fast if missing)
try {
    validateRequiredKeys();
} catch (err) {
    logger.error("App", "Startup validation failed", err);
    process.exit(1);
}

// Ensure output directories exist (required for Railway/ephemeral filesystem)
[OUTPUT_DIR, MEDIA_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info("App", `Created directory: ${dir}`);
    }
});

// ── 2. Import route modules ───────────────────────────────────────────────
const generateVideoRouter = require("./routes/generateVideo");

// ── 3. Create Express app ─────────────────────────────────────────────────
const app = express();

// ── 4. Global middleware ──────────────────────────────────────────────────

// Parse incoming JSON request bodies (e.g. { "topic": "AI trends" })
app.use(express.json());

// Parse URL-encoded form bodies (useful for HTML form submissions)
app.use(express.urlencoded({ extended: true }));

// Request logging (for Railway logs)
app.use((req, res, next) => {
    if (req.path !== "/health") {
        logger.info("App", `${req.method} ${req.path}`);
    }
    next();
});

// ── 5. Mount routes ───────────────────────────────────────────────────────

// Root – API info (includes Railway domain when deployed)
app.get("/", (req, res) => {
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
    const baseUrl = domain ? `https://${domain}` : null;
    res.json({
        name: "AI Content Engine",
        version: "1.0.0",
        status: "running",
        ...(baseUrl && {
            url: baseUrl,
            youtubeRedirectUri: `${baseUrl}/oauth2callback`,
        }),
        endpoints: {
            health: "GET /health",
            generateVideo: "POST /api/generate-video",
        },
    });
});

// Health check – for Railway, load balancers, n8n
app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

// Main pipeline route
app.use("/api", generateVideoRouter);

// ── 6. Global error handler ───────────────────────────────────────────────
// Catches any unhandled errors thrown in route handlers
app.use((err, req, res, next) => {
    logger.error("App", "Unhandled error", err);
    res.status(500).json({ success: false, error: err.message || "Internal server error" });
});

// ── 7. Start server ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    logger.info("App", `Server started on port ${PORT}`);
    logger.info("App", `POST /api/generate-video | GET /health`);
    console.log(`
╔══════════════════════════════════════════╗
║       AI Content Engine is running       ║
╠══════════════════════════════════════════╣
║  Port   : ${String(PORT).padEnd(30)}║
║  Health : GET /health                    ║
║  API    : POST /api/generate-video       ║
╚══════════════════════════════════════════╝
  `);
});

module.exports = app; // Export for testing if needed
