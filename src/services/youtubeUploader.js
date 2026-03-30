/**
 * src/services/youtubeUploader.js
 * ---------------------------------
 * STEP 5 (final) of the pipeline: Upload the finished video to YouTube
 * using the YouTube Data API v3 via Google OAuth2.
 *
 * Input  : videoPath   (string) – local path to finalVideo.mp4
 *          title       (string) – video title
 *          description (string) – video description (defaults to script)
 * Output : YouTube video URL (string)
 *
 * Workshop note – OAuth2 setup:
 *  1. Create a project in Google Cloud Console.
 *  2. Enable the YouTube Data API v3.
 *  3. Create OAuth2 credentials (Web application type).
 *  4. Run the helper script (see README) once to get a refresh token.
 *  5. Paste the refresh token into .env as YOUTUBE_REFRESH_TOKEN.
 *
 *  After that, this service handles token refresh automatically.
 */

const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const {
    YOUTUBE_CLIENT_ID,
    YOUTUBE_CLIENT_SECRET,
    YOUTUBE_REDIRECT_URI,
    YOUTUBE_REFRESH_TOKEN,
} = require("../../config/apiKeys");
const { getTrendingTags } = require("../../utils/trendingTags");

/**
 * getAuthenticatedClient
 * Builds and returns an authenticated OAuth2 client.
 * Uses session refresh token if provided, else env YOUTUBE_REFRESH_TOKEN.
 *
 * @param {string} [refreshToken] - Per-user token from session (overrides env)
 * @returns {google.auth.OAuth2} - Ready-to-use OAuth2 client
 */
function getAuthenticatedClient(refreshToken) {
    const token = refreshToken || YOUTUBE_REFRESH_TOKEN;
    if (!token) {
        throw new Error("No YouTube refresh token. Connect your channel in the UI or set YOUTUBE_REFRESH_TOKEN in .env");
    }

    const oauth2Client = new google.auth.OAuth2(
        YOUTUBE_CLIENT_ID,
        YOUTUBE_CLIENT_SECRET,
        YOUTUBE_REDIRECT_URI
    );

    oauth2Client.setCredentials({ refresh_token: token });
    return oauth2Client;
}

/**
 * Viral tags for English motivational Shorts — optimised for global reach.
 * Ordered by search volume / relevance. YouTube picks the most relevant subset.
 * Keep under 500 total chars (YouTube limit).
 */
const VIRAL_SHORTS_TAGS = [
    // Core Shorts discovery
    "shorts",
    "ytshorts",
    "shortvideo",
    "viral",
    "trending",
    "foryou",
    "foryoupage",
    // Motivation & mindset
    "motivation",
    "motivational",
    "dailymotivation",
    "morningmotivation",
    "mindset",
    "growthmindset",
    "successmindset",
    "positivevibes",
    "positivity",
    // Quotes niche
    "quotes",
    "quoteoftheday",
    "inspirationalquotes",
    "motivationalquotes",
    "wisdomquotes",
    "deepquotes",
    "lifequotes",
    "powerfulquotes",
    // Self-growth
    "selfimprovement",
    "personalgrowth",
    "selfcare",
    "lifelessons",
    "success",
    "focus",
    "discipline",
];

/** YouTube: max 500 chars total for tags, each tag max 30 chars */
const MAX_TAG_LENGTH = 30;
const MAX_TAGS_TOTAL_CHARS = 500;

/**
 * Build tags from topic + today's trending tags + viral base list.
 * Trending tags fetched from YouTube API (cached 23h). Deduplicates and enforces YouTube limits.
 * @param {string} topic - Video topic for keyword extraction
 * @param {string[]} trending - Today's trending tags (pre-fetched)
 * @returns {string[]} - Tag array for snippet.tags
 */
function buildViralTags(topic = "", trending = []) {
    const topicWords = String(topic)
        .toLowerCase()
        .replace(/[#@]/g, "")
        .split(/\s+/)
        .filter((w) => w.length >= 2 && w.length <= MAX_TAG_LENGTH)
        .slice(0, 5);
    // Priority: topic keywords → today's trending → evergreen viral base
    const combined = [...new Set([...topicWords, ...trending, ...VIRAL_SHORTS_TAGS])];
    const tags = [];
    let totalChars = 0;
    for (const t of combined) {
        const tag = t.slice(0, MAX_TAG_LENGTH).trim();
        if (!tag || tags.includes(tag)) continue;
        if (totalChars + tag.length + (tags.length ? 1 : 0) > MAX_TAGS_TOTAL_CHARS) break;
        tags.push(tag);
        totalChars += tag.length + (tags.length > 1 ? 1 : 0);
    }
    return tags.length ? tags : ["shorts", "viral", "motivation"];
}

/**
 * uploadToYouTube
 * @param {string} videoPath   - Absolute path to the video file
 * @param {string} title       - Title of the YouTube video
 * @param {string} description - Description of the YouTube video
 * @param {Object} [opts]      - Optional: { topic, tags, privacyStatus, thumbnailPath }
 * @returns {Promise<string>}  - Full URL to the uploaded video
 */
async function uploadToYouTube(
    videoPath,
    title = "AI Generated Short",
    description = "Created with AI Content Engine",
    opts = {}
) {
    const { topic = "", tags: customTags, privacyStatus = "public", thumbnailPath, refreshToken, categoryId = "27" } = opts;
    // Fetch today's trending tags (cached — costs 0 extra quota after first call)
    const trending = Array.isArray(customTags) && customTags.length > 0 ? [] : await getTrendingTags(10).catch(() => []);
    const tags = Array.isArray(customTags) && customTags.length > 0
        ? customTags.slice(0, 15).map((t) => String(t).slice(0, MAX_TAG_LENGTH))
        : buildViralTags(topic, trending);

    console.log(`[YouTubeUploader] Uploading: ${path.basename(videoPath)} (${privacyStatus})`);

    const auth = getAuthenticatedClient(refreshToken);
    const youtube = google.youtube({ version: "v3", auth });

    const response = await youtube.videos.insert({
        part: ["snippet", "status"],
        requestBody: {
            snippet: {
                title,
                description,
                tags,
                categoryId, // "27" = Education (default, best for self-improvement Shorts)
                defaultLanguage: "en",
            },
            status: {
                privacyStatus,
                selfDeclaredMadeForKids: false,
            },
        },
        media: {
            mimeType: "video/mp4",
            body: fs.createReadStream(videoPath),
        },
    });

    const videoId = response.data.id;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    if (thumbnailPath && fs.existsSync(thumbnailPath)) {
        try {
            await youtube.thumbnails.set({
                videoId,
                media: { mimeType: "image/jpeg", body: fs.createReadStream(thumbnailPath) },
            });
            console.log(`[YouTubeUploader] Custom thumbnail (Hook) set`);
        } catch (thumbErr) {
            console.warn(`[YouTubeUploader] Thumbnail upload failed:`, thumbErr.message);
        }
    }

    console.log(`[YouTubeUploader] Upload complete! URL: ${videoUrl}`);
    return videoUrl;
}

module.exports = { uploadToYouTube };
