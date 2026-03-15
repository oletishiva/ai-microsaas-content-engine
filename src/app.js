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
const session = require("express-session");
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
const authRouter = require("./routes/auth");

// ── 3. Create Express app ─────────────────────────────────────────────────
const app = express();

// ── 4. Global middleware ──────────────────────────────────────────────────

// Parse incoming JSON request bodies (e.g. { "topic": "AI trends" })
app.use(express.json());

// Parse URL-encoded form bodies (useful for HTML form submissions)
app.use(express.urlencoded({ extended: true }));

// Session (for per-user YouTube Connect)
const sessionSecret = process.env.SESSION_SECRET || "ai-content-engine-default-secret-change-in-production";
app.use(
    session({
        secret: sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: { secure: process.env.NODE_ENV === "production" && !!process.env.RAILWAY_PUBLIC_DOMAIN },
    })
);

// Request logging (for Railway logs)
app.use((req, res, next) => {
    if (req.path !== "/health") {
        logger.info("App", `${req.method} ${req.path}`);
    }
    next();
});

// ── 5. Mount routes ───────────────────────────────────────────────────────

// Static files (UI)
const publicDir = path.join(__dirname, "..", "public");
if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
}

// Root – serve UI for non-technical users
app.get("/", (req, res) => {
    const indexPath = path.join(publicDir, "index.html");
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.json({
            name: "AI Content Engine",
            status: "running",
            endpoints: { health: "GET /health", generateVideo: "POST /api/generate-video" },
        });
    }
});

// API info (for devs / debugging)
app.get("/api", (req, res) => {
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
    const baseUrl = domain ? `https://${domain}` : null;
    res.json({
        name: "AI Content Engine",
        version: "1.0.0",
        status: "running",
        ...(baseUrl && { url: baseUrl, youtubeRedirectUri: `${baseUrl}/oauth2callback` }),
        endpoints: { health: "GET /health", generateVideo: "POST /api/generate-video" },
    });
});

// Health check – for Railway, load balancers, n8n
app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

// Debug: check for hidden chars in ELEVENLABS_API_KEY (10=newline, 13=cr, 32=space). Remove after fixing.
app.get("/debug-eleven", (req, res) => {
    const key = process.env.ELEVENLABS_API_KEY || "";
    const codes = [...key].map((c) => c.charCodeAt(0));
    res.json({
        length: key.length,
        prefix: key.slice(0, 5),
        suffix: key.slice(-5),
        charCodes: codes,
        lastCharCode: codes.length ? codes[codes.length - 1] : null,
        hasNewline: codes.includes(10),
        hasCarriageReturn: codes.includes(13),
    });
});

// Debug: test ElevenLabs API directly from Railway. Remove after fixing.
app.get("/test-eleven", async (req, res) => {
    const axios = require("axios");
    try {
        const r = await axios.get("https://api.elevenlabs.io/v1/user", {
            headers: { "xi-api-key": (process.env.ELEVENLABS_API_KEY || "").trim() },
        });
        res.json({ success: true, user: r.data });
    } catch (e) {
        res.json({
            success: false,
            status: e.response?.status,
            error: e.response?.data || e.message,
        });
    }
});

// Debug: test ElevenLabs TTS endpoint (same as voiceGenerator). Remove after fixing.
app.get("/test-eleven-tts", async (req, res) => {
    const axios = require("axios");
    const apiKey = (process.env.ELEVENLABS_API_KEY || "").trim();
    const voiceId = (process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL").trim();
    try {
        const r = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
            { text: "Test.", model_id: "eleven_multilingual_v2" },
            {
                headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
                responseType: "arraybuffer",
            }
        );
        res.json({ success: true, audioLength: r.data?.byteLength });
    } catch (e) {
        res.json({
            success: false,
            status: e.response?.status,
            error: e.response?.data ? JSON.stringify(e.response.data) : e.message,
        });
    }
});

// Debug: test OpenAI API connectivity + key validity from Railway.
// Hit GET /test-openai to instantly diagnose key/network issues.
app.get("/test-openai", async (req, res) => {
    const OpenAI = require("openai");
    const key = (process.env.OPENAI_API_KEY || "").trim();
    if (!key) return res.json({ success: false, error: "OPENAI_API_KEY not set in Railway Variables" });
    try {
        const openai = new OpenAI({ apiKey: key, timeout: 15_000 });
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: "Say OK" }],
            max_tokens: 5,
        });
        res.json({
            success: true,
            keyPrefix: key.slice(0, 8) + "...",
            reply: completion.choices[0].message.content,
        });
    } catch (e) {
        res.json({
            success: false,
            keyPrefix: key.slice(0, 8) + "...",
            error: e.message,
            type: e.constructor.name,
        });
    }
});

// Auth routes (Connect YouTube)
app.use("/auth", authRouter);

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
