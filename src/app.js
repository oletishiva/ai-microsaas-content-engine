/**
 * src/app.js — updated 2026-04-12
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
require("../utils/bootstrap");

const fs = require("fs");
const path = require("path");
const express = require("express");
const session = require("express-session");
const { validateRequiredKeys } = require("../config/apiKeys");
const { OUTPUT_DIR, MEDIA_DIR } = require("../config/paths");
const logger = require("../utils/logger");

// Missing keys are not fatal: the first-run Settings page (/settings) collects them.
validateRequiredKeys();

// Ensure output directories exist (required for Railway/ephemeral filesystem)
[OUTPUT_DIR, MEDIA_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info("App", `Created directory: ${dir}`);
    }
});

// ── 2. Import route modules ───────────────────────────────────────────────
const generateVideoRouter  = require("./routes/generateVideo");
const authRouter           = require("./routes/auth");
const sametaRouter         = require("./routes/sameta");
const affirmationRouter    = require("./routes/affirmation");
const socialRouter         = require("./routes/social");
const mahabharatRouter     = require("./routes/mahabharat");
const studioRouter         = require("./routes/studio");
const settingsRouter       = require("./routes/settings");
const renderVideoRouter    = require("./routes/renderVideo");
const { startScheduler }            = require("./services/scheduler");
const { startMahabharatScheduler }  = require("./services/mahabharatScheduler");
const { startSametaScheduler }        = require("./services/sametaScheduler");
const { startAffirmationScheduler }   = require("./services/affirmationScheduler");

// ── 3. Create Express app ─────────────────────────────────────────────────
const app = express();

// ── 4. Global middleware ──────────────────────────────────────────────────

// Parse incoming JSON request bodies (e.g. { "topic": "AI trends" })
app.use(express.json());

// Parse URL-encoded form bodies (useful for HTML form submissions)
app.use(express.urlencoded({ extended: true }));

// Session (for per-user YouTube Connect)
function loadSessionSecret() {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
    const file = path.join(OUTPUT_DIR, ".session_secret");
    try { return fs.readFileSync(file, "utf8").trim(); } catch (_) {}
    const secret = require("crypto").randomBytes(32).toString("hex");
    try { fs.writeFileSync(file, secret, { mode: 0o600 }); } catch (_) {}
    return secret;
}
const sessionSecret = loadSessionSecret();
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
    app.use(express.static(publicDir, { index: false }));
}

// Generated videos/images are served from ./output so they can be previewed and downloaded locally
app.use("/output", express.static(OUTPUT_DIR, { dotfiles: "deny", index: false }));

// Root – first run goes to Settings, afterwards straight to the Studio
app.get("/", (req, res) => {
    res.redirect(settingsRouter.isConfigured() ? "/studio" : "/settings");
});

// Settings page – paste API keys, test them, saved to .env
app.get("/settings", (_, res) => {
    res.sendFile(path.join(publicDir, "settings.html"));
});

// Original multi-channel dashboard (Affirmations / Mahabharat / Sameta)
app.get("/classic", (_, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
});

// Setup page – channel manager (password-protected via ADMIN_SECRET)
app.get("/setup", (_, res) => {
    res.sendFile(path.join(publicDir, "setup.html"));
});

// Mahabharat generator page
app.get("/mahabharat", (_, res) => {
    res.sendFile(path.join(publicDir, "mahabharat.html"));
});

// AI Video Studio page
app.get("/studio", (_, res) => {
    res.sendFile(path.join(publicDir, "studio.html"));
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

// Download proxy — fetches video from Cloudinary server-side and serves it with
// Content-Disposition: attachment so iOS/Android browsers save instead of play.
// Usage: GET /api/download?url=<encoded-cloudinary-url>&filename=video.mp4
app.get("/api/download", async (req, res) => {
    const axios = require("axios");
    const { url, filename = "video.mp4" } = req.query;
    const safeName = String(filename).replace(/[^\w.\- ]/g, "_");
    // Local files produced by this app
    if (url && String(url).startsWith("/output/")) {
        const file = path.join(OUTPUT_DIR, path.basename(String(url)));
        if (!fs.existsSync(file)) return res.status(404).json({ error: "File not found" });
        return res.download(file, safeName);
    }
    if (!url || !url.startsWith("https://res.cloudinary.com/")) {
        return res.status(400).json({ error: "Invalid url" });
    }
    try {
        const upstream = await axios.get(url, { responseType: "stream" });
        res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
        res.setHeader("Content-Type", upstream.headers["content-type"] || "video/mp4");
        if (upstream.headers["content-length"]) {
            res.setHeader("Content-Length", upstream.headers["content-length"]);
        }
        upstream.data.pipe(res);
    } catch (err) {
        res.status(500).json({ error: "Download failed: " + err.message });
    }
});

// Settings API (local-only unless ADMIN_SECRET is set)
app.use("/api/settings", settingsRouter);

// Auth routes (Connect YouTube + Meta/Instagram/Facebook)
app.use("/auth", authRouter);

// Social OAuth + unified /api/publish endpoint
app.use("/auth", socialRouter);
app.use("/api",  socialRouter);

// Mahabharat Shorts script generator
app.use("/api", mahabharatRouter);

// Affirmations / Positive Vibes (English + Telugu)
app.use("/api", affirmationRouter);

// AI Video Studio — flexible guided + prompt video generator
app.use("/api", studioRouter);

// Main pipeline route
app.use("/api", generateVideoRouter);

// Telugu Sameta video route
app.use("/api", sametaRouter);

// n8n render-video endpoint (replaces Shotstack)
app.use("/api", renderVideoRouter);

// ── 6. Global error handler ───────────────────────────────────────────────
// Catches any unhandled errors thrown in route handlers
app.use((err, req, res, next) => {
    logger.error("App", "Unhandled error", err);
    res.status(500).json({ success: false, error: err.message || "Internal server error" });
});

// ── 7. Start server ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
// Local installs listen on this computer only (Settings can write API keys). Cloud hosts need 0.0.0.0.
const HOST = process.env.HOST || (process.env.RAILWAY_PROJECT_ID ? "0.0.0.0" : "127.0.0.1");

app.listen(PORT, HOST, () => {
    logger.info("App", `Server started on http://${HOST === "127.0.0.1" ? "localhost" : HOST}:${PORT}`);
    startScheduler();
    startMahabharatScheduler();
    startSametaScheduler();
    startAffirmationScheduler();
    console.log(`
╔══════════════════════════════════════════════╗
║        AI Content Studio is running          ║
╠══════════════════════════════════════════════╣
║  Open:  http://localhost:${String(PORT).padEnd(21)}║
╚══════════════════════════════════════════════╝
  `);
    if (process.env.OPEN_BROWSER === "1") {
        const url = `http://localhost:${PORT}`;
        const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
        require("child_process").exec(cmd, () => {});
    }
});

module.exports = app; // Export for testing if needed
