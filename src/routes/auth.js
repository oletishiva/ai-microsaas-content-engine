/**
 * src/routes/auth.js
 * ------------------
 * OAuth2 routes for per-user YouTube channel connection.
 * Users connect their channel via UI; videos upload to their channel.
 */

const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const {
    YOUTUBE_CLIENT_ID,
    YOUTUBE_CLIENT_SECRET,
} = require("../../config/apiKeys");

// File-based token fallback — survives process restarts within same Railway deployment
const TOKEN_FILE         = path.join(__dirname, "../../../output/.youtube_user_token");
const TOKEN_FILE_SAMETA  = path.join(__dirname, "../../../output/.youtube_sameta_token");
const TOKEN_FILE_MB      = path.join(__dirname, "../../../output/.youtube_mahabharat_token");
const TOKEN_FILE_AFF     = path.join(__dirname, "../../../output/.youtube_affirmation_token");

function tokenFileFor(channel) {
    if (channel === "sameta")       return TOKEN_FILE_SAMETA;
    if (channel === "mahabharat")   return TOKEN_FILE_MB;
    if (channel === "affirmation")  return TOKEN_FILE_AFF;
    return TOKEN_FILE; // default / legacy
}

// Channels that live in the main UI — not the /setup page
// studio → /studio, affirmation/sameta → /
const MAIN_UI_CHANNELS = ["affirmation", "sameta", "studio"];

function saveTokenToFile(token, channel) {
    try { fs.writeFileSync(tokenFileFor(channel), token, "utf8"); } catch (_) {}
    // Keep legacy file in sync for default channel
    if (!channel || channel === "default") {
        try { fs.writeFileSync(TOKEN_FILE, token, "utf8"); } catch (_) {}
    }
}
function loadTokenFromFile(channel) {
    try { return fs.readFileSync(tokenFileFor(channel), "utf8").trim() || null; } catch (_) { return null; }
}
function clearTokenFile(channel) {
    try { fs.unlinkSync(tokenFileFor(channel)); } catch (_) {}
    if (!channel || channel === "default") {
        try { fs.unlinkSync(TOKEN_FILE); } catch (_) {}
    }
}

// Map channel name → session key
function sessionKeyFor(channel) {
    if (channel === "mahabharat")  return "mbRefreshToken";
    if (channel === "affirmation") return "affYtToken";
    return "youtubeRefreshToken"; // default + sameta (legacy)
}

function getBaseUrl(req) {
    // Use request host so it works from any URL (mobile, custom domain, Railway subdomain)
    const host = req.get("x-forwarded-host") || req.get("host");
    const proto = (req.get("x-forwarded-proto") || "").toLowerCase();
    if (host) {
        const scheme = proto === "https" ? "https" : "http";
        return `${scheme}://${host}`;
    }
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
    if (domain) return `https://${domain}`;
    const port = process.env.PORT || 3000;
    return `http://localhost:${port}`;
}

function getOAuthClient(redirectUri) {
    return new google.auth.OAuth2(
        YOUTUBE_CLIENT_ID,
        YOUTUBE_CLIENT_SECRET,
        redirectUri
    );
}

/**
 * GET /auth/youtube?channel=sameta|mahabharat
 * Redirects to Google OAuth consent. User picks their channel.
 * channel param is stored in state so callback knows where to redirect.
 */
router.get("/youtube", (req, res) => {
    if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) {
        return res.redirect("/?error=YouTube+credentials+not+configured");
    }
    const channel  = req.query.channel || "default";
    const baseUrl  = getBaseUrl(req);
    const redirectUri = `${baseUrl}/auth/youtube/callback`;
    const oauth2Client = getOAuthClient(redirectUri);
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: [
            "https://www.googleapis.com/auth/youtube.upload",
            "https://www.googleapis.com/auth/youtube.readonly",
        ],
        prompt:  "select_account consent",
        state:   channel,   // passed back in callback so we know which channel
    });
    res.redirect(authUrl);
});

/**
 * GET /auth/youtube/callback
 * Receives code from Google, exchanges for tokens, stores refresh_token.
 * If channel=sameta|mahabharat (from state param), stores per-channel + redirects to /setup.
 * Otherwise (default Connect button from main UI), stores in session + redirects to /.
 */
router.get("/youtube/callback", async (req, res) => {
    const { code, error, state: channel } = req.query;
    if (error) {
        const back = channel && channel !== "default" ? "/setup" : "/";
        return res.redirect(`${back}?error=${encodeURIComponent(error)}`);
    }
    if (!code) {
        return res.redirect("/?error=No+code+received");
    }
    if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) {
        return res.redirect("/?error=YouTube+credentials+not+configured");
    }

    const baseUrl = getBaseUrl(req);
    const redirectUri = `${baseUrl}/auth/youtube/callback`;
    const oauth2Client = getOAuthClient(redirectUri);

    try {
        const { tokens } = await oauth2Client.getToken(code);
        const refreshToken = tokens.refresh_token;

        if (!refreshToken) {
            const back = channel && channel !== "default" ? "/setup" : "/";
            return res.redirect(`${back}?error=No+refresh+token+%E2%80%93+revoke+access+at+myaccount.google.com%2Fpermissions+and+retry`);
        }

        // Per-channel flow — save token under the right session key
        if (channel && channel !== "default") {
            saveTokenToFile(refreshToken, channel);
            req.session[sessionKeyFor(channel)] = refreshToken;
            // studio → /studio, affirmation/sameta → /, others → /setup
            const dest = channel === "studio"
                ? `/studio?youtube=connected`
                : MAIN_UI_CHANNELS.includes(channel)
                    ? `/?youtube=connected&service=${encodeURIComponent(channel)}`
                    : `/setup?connected=${encodeURIComponent(channel)}&token=${encodeURIComponent(refreshToken)}`;
            return req.session.save(() => res.redirect(dest));
        }

        // Default flow (main UI Connect button)
        req.session.youtubeRefreshToken = refreshToken;
        saveTokenToFile(refreshToken);
        req.session.save((err) => {
            if (err) return res.redirect("/?error=Session+save+failed");
            res.redirect("/?youtube=connected");
        });
    } catch (err) {
        console.error("[Auth] YouTube callback error:", err.message);
        const back = channel && channel !== "default" ? "/setup" : "/";
        res.redirect(`${back}?error=${encodeURIComponent(err.message)}`);
    }
});

/**
 * GET /auth/youtube/status?channel=sameta|mahabharat
 * Returns { connected: boolean, channelTitle?: string }
 */
router.get("/youtube/status", async (req, res) => {
    if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) {
        return res.json({ connected: false, hasOAuth: false });
    }
    const channel    = req.query.channel || "default";
    const sessionKey = sessionKeyFor(channel);

    // Prefer env var for mahabharat channel (set via Railway Variables)
    const envToken = channel === "mahabharat" ? process.env.MAHABHARAT_YOUTUBE_REFRESH_TOKEN : null;
    const token = envToken || req.session?.[sessionKey] || loadTokenFromFile(channel);
    if (!token) {
        return res.json({ connected: false, hasOAuth: true });
    }
    if (!req.session[sessionKey] && token) req.session[sessionKey] = token;
    try {
        const baseUrl = getBaseUrl(req);
        const redirectUri = `${baseUrl}/auth/youtube/callback`;
        const oauth2Client = getOAuthClient(redirectUri);
        oauth2Client.setCredentials({ refresh_token: token });
        const youtube = google.youtube({ version: "v3", auth: oauth2Client });
        const channels = await youtube.channels.list({ part: "snippet", mine: true });
        const channelTitle = channels.data.items?.[0]?.snippet?.title || "Your channel";
        res.json({ connected: true, channelTitle, hasOAuth: true });
    } catch (err) {
        req.session[sessionKey] = undefined;
        res.json({ connected: false, hasOAuth: true });
    }
});

/**
 * GET /auth/youtube/redirect-uri
 * Returns the redirect URI used for OAuth (add this exact URL to Google Console).
 */
router.get("/youtube/redirect-uri", (req, res) => {
    const baseUrl = getBaseUrl(req);
    const redirectUri = `${baseUrl}/auth/youtube/callback`;
    res.json({ redirectUri });
});

/**
 * POST /auth/youtube/disconnect?channel=sameta|mahabharat
 * Clears stored refresh token from session + file.
 */
router.post("/youtube/disconnect", (req, res) => {
    const channel    = req.query.channel || req.body?.channel || "default";
    const sessionKey = sessionKeyFor(channel);
    req.session[sessionKey] = undefined;
    clearTokenFile(channel);
    req.session.save(() => res.json({ success: true }));
});

/**
 * GET /auth/setup/check
 * Validates ADMIN_SECRET and returns stored token env-var names for the setup page.
 */
router.get("/setup/check", (req, res) => {
    const secret = req.query.secret || "";
    const adminSecret = process.env.ADMIN_SECRET || "";
    if (!adminSecret || secret !== adminSecret) {
        return res.status(401).json({ ok: false, error: "Invalid secret" });
    }
    res.json({
        ok: true,
        sametaToken:       loadTokenFromFile("sameta")       || process.env.YOUTUBE_REFRESH_TOKEN                || null,
        mbToken:           loadTokenFromFile("mahabharat")   || process.env.MAHABHARAT_YOUTUBE_REFRESH_TOKEN     || null,
        affirmationToken:  loadTokenFromFile("affirmation")  || null,
    });
});

module.exports = router;
