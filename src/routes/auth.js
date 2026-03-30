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
const TOKEN_FILE = path.join(__dirname, "../../../output/.youtube_user_token");

function saveTokenToFile(token) {
    try { fs.writeFileSync(TOKEN_FILE, token, "utf8"); } catch (_) {}
}
function loadTokenFromFile() {
    try { return fs.readFileSync(TOKEN_FILE, "utf8").trim() || null; } catch (_) { return null; }
}
function clearTokenFile() {
    try { fs.unlinkSync(TOKEN_FILE); } catch (_) {}
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
 * GET /auth/youtube
 * Redirects to Google OAuth consent. User picks their channel.
 */
router.get("/youtube", (req, res) => {
    if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) {
        return res.redirect("/?error=YouTube+credentials+not+configured");
    }
    const baseUrl = getBaseUrl(req);
    const redirectUri = `${baseUrl}/auth/youtube/callback`;
    const oauth2Client = getOAuthClient(redirectUri);
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: [
            "https://www.googleapis.com/auth/youtube.upload",
            "https://www.googleapis.com/auth/youtube.readonly",
        ],
        prompt: "select_account consent",
    });
    res.redirect(authUrl);
});

/**
 * GET /auth/youtube/callback
 * Receives code from Google, exchanges for tokens, stores refresh_token in session.
 */
router.get("/youtube/callback", async (req, res) => {
    const { code, error } = req.query;
    if (error) {
        return res.redirect(`/?error=${encodeURIComponent(error)}`);
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
            return res.redirect("/?error=No+refresh+token+%E2%80%93+try+revoking+access+at+myaccount.google.com%2Fpermissions");
        }

        req.session.youtubeRefreshToken = refreshToken;
        saveTokenToFile(refreshToken); // persist across process restarts
        req.session.save((err) => {
            if (err) {
                return res.redirect("/?error=Session+save+failed");
            }
            res.redirect("/?youtube=connected");
        });
    } catch (err) {
        console.error("[Auth] YouTube callback error:", err.message);
        res.redirect(`/?error=${encodeURIComponent(err.message)}`);
    }
});

/**
 * GET /auth/youtube/status
 * Returns { connected: boolean, channelTitle?: string }
 */
router.get("/youtube/status", async (req, res) => {
    if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) {
        return res.json({ connected: false, hasOAuth: false });
    }
    const token = req.session?.youtubeRefreshToken || loadTokenFromFile();
    if (!token) {
        return res.json({ connected: false, hasOAuth: true });
    }
    // Restore into session if it came from file
    if (!req.session.youtubeRefreshToken && token) {
        req.session.youtubeRefreshToken = token;
    }
    try {
        const baseUrl = getBaseUrl(req);
        const redirectUri = `${baseUrl}/auth/youtube/callback`;
        const oauth2Client = getOAuthClient(redirectUri);
        oauth2Client.setCredentials({ refresh_token: token });
        const youtube = google.youtube({ version: "v3", auth: oauth2Client });
        const channels = await youtube.channels.list({
            part: "snippet",
            mine: true,
        });
        const channelTitle = channels.data.items?.[0]?.snippet?.title || "Your channel";
        res.json({ connected: true, channelTitle, hasOAuth: true });
    } catch (err) {
        req.session.youtubeRefreshToken = undefined;
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
 * POST /auth/youtube/disconnect
 * Clears stored refresh token from session.
 */
router.post("/youtube/disconnect", (req, res) => {
    req.session.youtubeRefreshToken = undefined;
    clearTokenFile();
    req.session.save((err) => {
        res.json({ success: true });
    });
});

module.exports = router;
