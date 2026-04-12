/**
 * src/services/metaPublisher.js
 * ──────────────────────────────
 * Publishes Reels to Instagram + videos to Facebook Pages via Meta Graph API.
 *
 * One OAuth flow covers BOTH platforms (Instagram Business + Facebook Page).
 *
 * Flow:
 *  1. User connects via /auth/meta (Facebook OAuth with instagram+pages scopes)
 *  2. Short-lived token → exchanged for long-lived (60-day) token
 *  3. /me/accounts returns page tokens (never expire) + Instagram account IDs
 *  4. POST /api/publish { videoUrl, caption, platforms: ["instagram","facebook"] }
 */

const axios = require("axios");
const logger = require("../../utils/logger");

const API_VERSION = "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

// ── Token exchange ────────────────────────────────────────────────────────────

/**
 * Exchange a short-lived user token (from OAuth code) for a long-lived one (~60 days).
 */
async function getLongLivedToken(shortToken) {
    const { data } = await axios.get(`${BASE}/oauth/access_token`, {
        params: {
            grant_type:       "fb_exchange_token",
            client_id:        process.env.META_APP_ID,
            client_secret:    process.env.META_APP_SECRET,
            fb_exchange_token: shortToken,
        },
    });
    return data.access_token;
}

// ── Account discovery ─────────────────────────────────────────────────────────

/**
 * From a user token, discover linked Instagram Business account + Facebook Pages.
 * Returns first match of each (users typically have one IG + one FB page).
 */
async function getAccountInfo(userToken) {
    const { data } = await axios.get(`${BASE}/me/accounts`, {
        params: {
            access_token: userToken,
            fields: "id,name,access_token,instagram_business_account{id,username,followers_count}",
        },
    });

    let instagramAccountId   = null;
    let instagramUsername    = null;
    let instagramFollowers   = null;
    let facebookPageId       = null;
    let facebookPageToken    = null;
    let facebookPageName     = null;

    for (const page of (data.data || [])) {
        if (!facebookPageId) {
            facebookPageId    = page.id;
            facebookPageToken = page.access_token;
            facebookPageName  = page.name;
        }
        if (!instagramAccountId && page.instagram_business_account?.id) {
            instagramAccountId = page.instagram_business_account.id;
            instagramUsername  = page.instagram_business_account.username || null;
            instagramFollowers = page.instagram_business_account.followers_count || null;
        }
    }

    return {
        instagramAccountId,
        instagramUsername,
        instagramFollowers,
        facebookPageId,
        facebookPageToken,
        facebookPageName,
    };
}

// ── Instagram Reels publishing ────────────────────────────────────────────────

/**
 * Publish a Reel to Instagram.
 * videoUrl MUST be a publicly accessible HTTPS URL (Cloudinary URL works perfectly).
 * Returns the permalink URL.
 */
async function publishInstagramReel(igAccountId, userToken, { videoUrl, caption }) {
    logger.info("Meta", "Instagram: creating Reel container...");

    // Step 1: Create media container
    const { data: container } = await axios.post(
        `${BASE}/${igAccountId}/media`,
        null,
        {
            params: {
                access_token:  userToken,
                media_type:    "REELS",
                video_url:     videoUrl,
                caption,
                share_to_feed: true,
            },
        }
    );

    const creationId = container.id;
    logger.info("Meta", `Instagram: container ${creationId} created — polling for FINISHED...`);

    // Step 2: Poll until FINISHED (max 3 minutes, every 5s)
    const MAX_POLLS = 36;
    for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const { data: statusData } = await axios.get(`${BASE}/${creationId}`, {
            params: { access_token: userToken, fields: "status_code,status" },
        });
        logger.info("Meta", `Instagram: status = ${statusData.status_code} (poll ${i + 1}/${MAX_POLLS})`);
        if (statusData.status_code === "FINISHED") break;
        if (statusData.status_code === "ERROR") {
            throw new Error(`Instagram Reel container error: ${JSON.stringify(statusData)}`);
        }
        if (i === MAX_POLLS - 1) throw new Error("Instagram Reel timed out (3 min) — video may still process");
    }

    // Step 3: Publish
    logger.info("Meta", "Instagram: publishing Reel...");
    const { data: published } = await axios.post(
        `${BASE}/${igAccountId}/media_publish`,
        null,
        { params: { access_token: userToken, creation_id: creationId } }
    );

    // Step 4: Get permalink
    const { data: mediaData } = await axios.get(`${BASE}/${published.id}`, {
        params: { access_token: userToken, fields: "permalink" },
    });

    const url = mediaData.permalink || `https://www.instagram.com/`;
    logger.info("Meta", `Instagram: published! ${url}`);
    return url;
}

// ── Facebook Page video publishing ────────────────────────────────────────────

/**
 * Publish a video to a Facebook Page.
 * pageToken = the page-specific token from getAccountInfo() (never expires).
 * Returns a URL to the video.
 */
async function publishFacebookVideo(pageId, pageToken, { videoUrl, caption, title }) {
    logger.info("Meta", "Facebook: uploading video to Page...");

    const { data } = await axios.post(
        `${BASE}/${pageId}/videos`,
        null,
        {
            params: {
                access_token: pageToken,
                file_url:     videoUrl,
                description:  caption,
                title:        title || "New Video",
            },
        }
    );

    const videoId = data.id;
    logger.info("Meta", `Facebook: video published (ID: ${videoId})`);
    return `https://www.facebook.com/video/${videoId}`;
}

module.exports = {
    getLongLivedToken,
    getAccountInfo,
    publishInstagramReel,
    publishFacebookVideo,
};
