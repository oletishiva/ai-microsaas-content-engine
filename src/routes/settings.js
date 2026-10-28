/**
 * src/routes/settings.js
 * ----------------------
 * First-run setup API used by /settings. Lets a customer paste API keys in the
 * browser instead of editing .env by hand. Keys are written to ./.env.
 *
 * Security: only reachable from this computer (loopback), or with the
 * ADMIN_SECRET header when the app is hosted online.
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { ROOT } = require("../../config/paths");

const router = express.Router();
const ENV_FILE = path.join(ROOT, ".env");

// key → label/help shown on the Settings page
const FIELDS = [
    { key: "ANTHROPIC_API_KEY", group: "ai", label: "Anthropic (Claude) key", help: "Writes scripts and scene ideas. https://console.anthropic.com/settings/keys" },
    { key: "OPENAI_API_KEY", group: "ai", label: "OpenAI key", help: "Images (DALL·E) and script fallback. https://platform.openai.com/api-keys" },
    { key: "GEMINI_API_KEY", group: "ai", label: "Google Gemini key (optional)", help: "Cheaper Imagen images. https://aistudio.google.com/apikey" },
    { key: "PEXELS_API_KEY", group: "ai", label: "Pexels key (optional, free)", help: "Free stock photos when no AI image key is set. https://www.pexels.com/api/" },
    { key: "YOUTUBE_CLIENT_ID", group: "publish", label: "YouTube client ID", help: "Google Cloud Console → Credentials → OAuth client (Web). Redirect URI is shown below." },
    { key: "YOUTUBE_CLIENT_SECRET", group: "publish", label: "YouTube client secret", secret: true },
    { key: "CLOUDINARY_CLOUD_NAME", group: "publish", label: "Cloudinary cloud name (Instagram/Facebook only)", help: "Needed only to post to Instagram/Facebook (they need a public video URL)." },
    { key: "CLOUDINARY_API_KEY", group: "publish", label: "Cloudinary API key" },
    { key: "CLOUDINARY_API_SECRET", group: "publish", label: "Cloudinary API secret", secret: true },
    { key: "META_APP_ID", group: "publish", label: "Meta app ID (Instagram/Facebook)" },
    { key: "META_APP_SECRET", group: "publish", label: "Meta app secret", secret: true },
];
const KEYS = new Set(FIELDS.map((f) => f.key));

function isConfigured() {
    return !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY || process.env.PEXELS_API_KEY);
}
router.isConfigured = isConfigured;

function mask(v) {
    if (!v) return "";
    return v.length <= 8 ? "••••" : `${v.slice(0, 3)}••••${v.slice(-4)}`;
}

function guard(req, res, next) {
    const admin = process.env.ADMIN_SECRET;
    if (admin && req.get("x-admin-secret") === admin) return next();
    const ip = req.socket.remoteAddress || "";
    const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip);
    const proxied = !!req.get("x-forwarded-for");
    if (local && !proxied) return next();
    res.status(403).json({ error: "Settings can only be changed from the computer running the app (or with ADMIN_SECRET)." });
}
router.use(guard);

function writeEnv(updates) {
    let lines = [];
    try { lines = fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/); } catch (_) {}
    const done = new Set();
    lines = lines.map((line) => {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
        if (m && m[1] in updates) { done.add(m[1]); return `${m[1]}=${updates[m[1]]}`; }
        return line;
    });
    for (const [k, v] of Object.entries(updates)) if (!done.has(k)) lines.push(`${k}=${v}`);
    fs.writeFileSync(ENV_FILE, lines.filter((l, i, a) => l !== "" || i < a.length - 1).join("\n") + "\n", { mode: 0o600 });
}

router.get("/", (req, res) => {
    const port = process.env.PORT || 3000;
    res.json({
        configured: isConfigured(),
        fields: FIELDS.map((f) => ({ ...f, set: !!process.env[f.key], preview: f.secret ? (process.env[f.key] ? "••••" : "") : mask(process.env[f.key]) })),
        youtubeRedirectUri: `http://localhost:${port}/auth/youtube/callback`,
        ffmpeg: process.env.FFMPEG_PATH ? "bundled" : "system",
    });
});

router.post("/", (req, res) => {
    const values = req.body?.values || {};
    const updates = {};
    for (const [k, raw] of Object.entries(values)) {
        if (!KEYS.has(k) || typeof raw !== "string") continue;
        const v = raw.trim().replace(/[\r\n]/g, "");
        if (v === "") continue; // blank = leave unchanged
        updates[k] = v;
    }
    if (!Object.keys(updates).length) return res.json({ success: true, saved: 0 });
    try {
        writeEnv(updates);
    } catch (e) {
        return res.status(500).json({ error: `Could not write .env: ${e.message}` });
    }
    Object.assign(process.env, updates);
    // Some modules read keys at load time – the launcher restarts us (exit code 75) to pick them up.
    const restart = process.env.STUDIO_SUPERVISED === "1" && !req.body?.noRestart;
    res.json({ success: true, saved: Object.keys(updates).length, restarting: restart });
    if (restart) setTimeout(() => process.exit(75), 400);
});

router.post("/test", async (req, res) => {
    const service = req.body?.service;
    const t = { timeout: 15000 };
    try {
        if (service === "anthropic") {
            await axios.get("https://api.anthropic.com/v1/models", { ...t, headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" } });
        } else if (service === "openai") {
            await axios.get("https://api.openai.com/v1/models", { ...t, headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
        } else if (service === "gemini") {
            await axios.get("https://generativelanguage.googleapis.com/v1beta/models", { ...t, params: { key: process.env.GEMINI_API_KEY } });
        } else if (service === "pexels") {
            await axios.get("https://api.pexels.com/v1/search", { ...t, params: { query: "sky", per_page: 1 }, headers: { Authorization: process.env.PEXELS_API_KEY } });
        } else {
            return res.status(400).json({ ok: false, error: "Unknown service" });
        }
        res.json({ ok: true });
    } catch (e) {
        const status = e.response?.status;
        res.json({ ok: false, error: status === 401 || status === 403 ? "Key rejected (check it was copied fully)" : (e.response?.data?.error?.message || e.message) });
    }
});

module.exports = router;
