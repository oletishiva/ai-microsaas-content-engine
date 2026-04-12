/**
 * src/routes/social.js
 * ─────────────────────
 * Meta OAuth (ONE flow covers Instagram + Facebook) + unified /api/publish endpoint.
 *
 * ENV vars required (add to Railway Variables):
 *   META_APP_ID      — from Meta Developer Portal → App → Settings → Basic
 *   META_APP_SECRET  — same place
 *
 * Setup steps (one-time, 5 min):
 *  1. Create a Meta App at developers.facebook.com (type: Business)
 *  2. Add "Instagram Graph API" + "Facebook Login for Business" products
 *  3. Add redirect URI: https://<your-railway-domain>/auth/meta/callback
 *  4. Set META_APP_ID + META_APP_SECRET in Railway Variables
 *
 * Routes:
 *   GET  /auth/meta             → start OAuth (redirects to Facebook login)
 *   GET  /auth/meta/callback    → exchange code → long-lived token → save
 *   GET  /auth/meta/status      → { connected, instagramUsername, facebookPageName }
 *   POST /auth/meta/disconnect  → clear stored tokens
 *
 *   POST /api/publish           → unified multi-platform publish
 *     Body: { videoUrl, caption, title?, platforms: ["instagram","facebook","youtube"] }
 *     Returns: { success, results: { instagram?, facebook?, youtube? } }
 */

const express   = require("express");
const router    = express.Router();
const fs        = require("fs");
const path      = require("path");
const axios     = require("axios");
const logger    = require("../../utils/logger");
const {
    getLongLivedToken,
    getAccountInfo,
    publishInstagramReel,
    publishFacebookVideo,
} = require("../services/metaPublisher");
const { uploadToYouTube } = require("../services/youtubeUploader");

// ── Token persistence (survives Railway redeploys) ────────────────────────────

const META_TOKEN_FILE = path.join(__dirname, "../../../output/.meta_tokens.json");

function saveMetaTokens(tokens) {
    try { fs.writeFileSync(META_TOKEN_FILE, JSON.stringify(tokens), "utf8"); } catch (_) {}
}
function loadMetaTokens() {
    try {
        const raw = fs.readFileSync(META_TOKEN_FILE, "utf8");
        return JSON.parse(raw);
    } catch (_) { return null; }
}
function clearMetaTokens() {
    try { fs.unlinkSync(META_TOKEN_FILE); } catch (_) {}
}

function getBaseUrl(req) {
    const host  = req.get("x-forwarded-host") || req.get("host");
    const proto = (req.get("x-forwarded-proto") || "").toLowerCase();
    if (host) return `${proto === "https" ? "https" : "http"}://${host}`;
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
    if (domain) return `https://${domain}`;
    return `http://localhost:${process.env.PORT || 3000}`;
}

// ── Debug ─────────────────────────────────────────────────────────────────────
router.get("/meta/debug", (req, res) => {
    const appId = process.env.META_APP_ID;
    const hasSecret = !!process.env.META_APP_SECRET;
    const redirectUri = `${getBaseUrl(req)}/auth/meta/callback`;
    const scopes = "instagram_content_publish,instagram_basic,pages_manage_posts,pages_read_engagement,pages_show_list";
    const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&response_type=code`;
    res.json({ appId, appIdLength: appId?.length, hasSecret, redirectUri, authUrl });
});

// ── OAuth ─────────────────────────────────────────────────────────────────────

/**
 * GET /auth/meta
 * Redirects user to Facebook OAuth. Covers both Instagram + Facebook in one flow.
 */
router.get("/meta", (req, res) => {
    const appId = process.env.META_APP_ID;
    if (!appId) return res.redirect("/?error=META_APP_ID+not+configured");

    const redirectUri = `${getBaseUrl(req)}/auth/meta/callback`;
    const scopes = [
        "instagram_content_publish",
        "instagram_basic",
        "pages_manage_posts",
        "pages_read_engagement",
        "pages_show_list",
    ].join(",");

    const authUrl = `https://www.facebook.com/v21.0/dialog/oauth` +
        `?client_id=${appId}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&response_type=code`;

    res.redirect(authUrl);
});

/**
 * GET /auth/meta/callback
 * Receives code → exchanges for short-lived token → upgrades to long-lived → discovers accounts.
 */
router.get("/meta/callback", async (req, res) => {
    const { code, error } = req.query;
    if (error)  return res.redirect(`/?error=${encodeURIComponent(error)}`);
    if (!code)  return res.redirect("/?error=No+code+from+Meta");

    const appId     = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) return res.redirect("/?error=META_APP_ID+or+META_APP_SECRET+not+configured");

    try {
        const redirectUri = `${getBaseUrl(req)}/auth/meta/callback`;

        // Step 1: Short-lived token
        const { data: tokenData } = await axios.get(`https://graph.facebook.com/v21.0/oauth/access_token`, {
            params: { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code },
        });
        const shortToken = tokenData.access_token;

        // Step 2: Upgrade to long-lived token (~60 days)
        const longToken = await getLongLivedToken(shortToken);

        // Step 3: Discover Instagram account + Facebook Page
        const accounts = await getAccountInfo(longToken);

        // Step 4: Save everything
        const tokens = { userToken: longToken, ...accounts, connectedAt: new Date().toISOString() };
        saveMetaTokens(tokens);
        if (req.session) req.session.metaTokens = tokens;

        logger.info("Auth", `Meta connected: IG=@${accounts.instagramUsername}, FB=${accounts.facebookPageName}`);
        res.redirect("/?meta=connected");
    } catch (err) {
        logger.error("Auth", "Meta callback error:", err.response?.data || err.message);
        const msg = err.response?.data?.error?.message || err.message;
        res.redirect(`/?error=${encodeURIComponent(msg)}`);
    }
});

/**
 * GET /auth/meta/status
 * Returns { connected, instagramUsername, instagramFollowers, facebookPageName }
 */
router.get("/meta/status", (req, res) => {
    if (!process.env.META_APP_ID) {
        return res.json({ connected: false, configured: false });
    }
    const tokens = (req.session?.metaTokens) || loadMetaTokens();
    if (!tokens?.userToken) {
        return res.json({ connected: false, configured: true });
    }
    // Restore session from file if needed
    if (!req.session?.metaTokens && tokens) {
        if (req.session) req.session.metaTokens = tokens;
    }
    res.json({
        connected:           true,
        configured:          true,
        instagramUsername:   tokens.instagramUsername  || null,
        instagramFollowers:  tokens.instagramFollowers || null,
        facebookPageName:    tokens.facebookPageName   || null,
        connectedAt:         tokens.connectedAt        || null,
    });
});

/**
 * GET /auth/meta/redirect-uri
 * Returns the exact redirect URI to add in Meta Developer Portal.
 */
router.get("/meta/redirect-uri", (req, res) => {
    res.json({ redirectUri: `${getBaseUrl(req)}/auth/meta/callback` });
});

/**
 * POST /auth/meta/disconnect
 */
router.post("/meta/disconnect", (req, res) => {
    if (req.session) req.session.metaTokens = undefined;
    clearMetaTokens();
    res.json({ success: true });
});

// ── Unified /api/publish ──────────────────────────────────────────────────────

/**
 * POST /api/publish
 * ──────────────────
 * Publish a video to one or more platforms in a single API call.
 *
 * Body (JSON):
 *   videoUrl   {string}   REQUIRED — public HTTPS URL (Cloudinary recommended)
 *   caption    {string}   Caption / description (used for IG + FB)
 *   title      {string}   Title (used for YouTube + FB)
 *   platforms  {string[]} ["instagram", "facebook", "youtube"] — default all connected
 *
 * Returns:
 *   {
 *     success: true,
 *     results: {
 *       instagram?: { success: true, url: "https://instagram.com/p/..." },
 *       facebook?:  { success: true, url: "https://facebook.com/video/..." },
 *       youtube?:   { success: true, url: "https://youtube.com/watch?v=..." },
 *     }
 *   }
 */
router.post("/publish", async (req, res) => {
    const {
        videoUrl,
        caption     = "",
        title       = "New Video",
        platforms   = ["instagram", "facebook", "youtube"],
    } = req.body;

    if (!videoUrl) {
        return res.status(400).json({ success: false, error: "videoUrl is required" });
    }
    if (!Array.isArray(platforms) || platforms.length === 0) {
        return res.status(400).json({ success: false, error: "platforms array is required" });
    }

    const results = {};

    // ── Instagram ──────────────────────────────────────────────────────────
    if (platforms.includes("instagram")) {
        const tokens = (req.session?.metaTokens) || loadMetaTokens();
        if (!tokens?.userToken || !tokens?.instagramAccountId) {
            results.instagram = { success: false, error: "Instagram not connected. Go to /auth/meta to connect." };
        } else {
            try {
                const url = await publishInstagramReel(
                    tokens.instagramAccountId,
                    tokens.userToken,
                    { videoUrl, caption }
                );
                results.instagram = { success: true, url };
            } catch (err) {
                logger.warn("Publish", "Instagram failed:", err.message);
                results.instagram = { success: false, error: err.message };
            }
        }
    }

    // ── Facebook ───────────────────────────────────────────────────────────
    if (platforms.includes("facebook")) {
        const tokens = (req.session?.metaTokens) || loadMetaTokens();
        if (!tokens?.facebookPageId || !tokens?.facebookPageToken) {
            results.facebook = { success: false, error: "Facebook Page not connected. Go to /auth/meta to connect." };
        } else {
            try {
                const url = await publishFacebookVideo(
                    tokens.facebookPageId,
                    tokens.facebookPageToken,
                    { videoUrl, caption, title }
                );
                results.facebook = { success: true, url };
            } catch (err) {
                logger.warn("Publish", "Facebook failed:", err.message);
                results.facebook = { success: false, error: err.message };
            }
        }
    }

    // ── YouTube ────────────────────────────────────────────────────────────
    if (platforms.includes("youtube")) {
        const apiKeys = require("../../config/apiKeys");
        const TOKEN_FILE = path.join(__dirname, "../../../output/.youtube_user_token");
        const fileToken = (() => { try { return fs.readFileSync(TOKEN_FILE, "utf8").trim() || null; } catch (_) { return null; } })();
        const ytToken = req.session?.youtubeRefreshToken || fileToken;
        const canYouTube = apiKeys.hasYouTubeConfig || (apiKeys.hasYouTubeOAuthConfig && ytToken);

        if (!canYouTube) {
            results.youtube = { success: false, error: "YouTube not connected. Go to /auth/youtube to connect." };
        } else {
            try {
                const ytDesc = `${caption}\n\n#shorts #viral #motivation`;
                const url = await uploadToYouTube(videoUrl, title, ytDesc, {
                    privacyStatus:  "public",
                    refreshToken:   ytToken || undefined,
                    isVideoUrl:     true,
                });
                results.youtube = { success: true, url };
            } catch (err) {
                logger.warn("Publish", "YouTube failed:", err.message);
                results.youtube = { success: false, error: err.message };
            }
        }
    }

    const anySuccess = Object.values(results).some((r) => r.success);
    res.status(anySuccess ? 200 : 502).json({ success: anySuccess, results });
});

module.exports = router;
