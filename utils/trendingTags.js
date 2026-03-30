/**
 * utils/trendingTags.js
 * ----------------------
 * Fetches today's trending YouTube tags by looking at the top 50 trending
 * Shorts/videos and extracting their most-used tags.
 *
 * Uses the same YouTube Data API v3 credentials already in .env.
 * Cost: 1 unit per region call (negligible — well within 10k/day quota).
 * Cache: results saved to /tmp/trending_tags_cache.json and reused for 23h.
 *
 * Regions fetched: US, GB, IN (covers our main target markets).
 */

const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const logger = require("./logger");

const CACHE_FILE = path.join(require("os").tmpdir(), "trending_tags_cache.json");
const CACHE_TTL_MS = 23 * 60 * 60 * 1000; // 23 hours

/**
 * Tags that are too generic or off-topic to add value — skip these.
 * We already include shorts, motivation, etc. in our base viral list.
 */
const BLOCKLIST = new Set([
    "video", "youtube", "2024", "2025", "2026", "new", "best",
    "funny", "gaming", "game", "music", "song", "dance", "comedy",
    "vlog", "challenge", "reaction", "meme", "movie", "film",
    "cricket", "football", "soccer", "nba", "nfl", "sport",
]);

/**
 * Build a YouTube client using API key (for public read-only endpoints like mostPopular).
 * Requires YOUTUBE_API_KEY in .env — a simple browser/server key from Google Cloud Console,
 * no OAuth needed. If not set, returns null and trending tags are skipped.
 *
 * To get one:
 *   Google Cloud Console → APIs & Services → Credentials → Create Credentials → API key
 *   Restrict to "YouTube Data API v3"
 */
function buildYouTubeClient() {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) return null;
    return google.youtube({ version: "v3", auth: apiKey });
}

/**
 * Fetch tags from top trending videos in a given region.
 * @param {object} youtube - Authenticated YouTube client
 * @param {string} regionCode - e.g. "US", "GB", "IN"
 * @returns {Promise<string[]>} - flat list of tags
 */
async function fetchRegionTags(youtube, regionCode) {
    try {
        // Step 1: Get top 50 trending video IDs
        const listRes = await youtube.videos.list({
            part: ["id"],
            chart: "mostPopular",
            regionCode,
            maxResults: 50,
        });

        const videoIds = (listRes.data.items || []).map((v) => v.id);
        if (videoIds.length === 0) return [];

        // Step 2: Fetch snippet (includes tags) for those videos
        const snippetRes = await youtube.videos.list({
            part: ["snippet"],
            id: videoIds.join(","),
            maxResults: 50,
        });

        const tags = [];
        for (const item of snippetRes.data.items || []) {
            for (const tag of item.snippet?.tags || []) {
                const clean = tag.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
                if (
                    clean.length >= 3 &&
                    clean.length <= 30 &&
                    !BLOCKLIST.has(clean)
                ) {
                    tags.push(clean);
                }
            }
        }
        return tags;
    } catch (err) {
        logger.warn("TrendingTags", `Failed for region ${regionCode}: ${err.message}`);
        return [];
    }
}

/**
 * Get top N trending tags across US, GB, IN markets.
 * Uses a frequency count — tags appearing in multiple regions rank higher.
 * Returns a cached result if it's less than 23 hours old.
 *
 * @param {number} [limit=15] - Max tags to return
 * @returns {Promise<string[]>} - deduplicated, ranked trending tags
 */
async function getTrendingTags(limit = 15) {
    // Check cache first
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
            const age = Date.now() - (cached.timestamp || 0);
            if (age < CACHE_TTL_MS && Array.isArray(cached.tags) && cached.tags.length > 0) {
                logger.info("TrendingTags", `Using cached tags (${Math.round(age / 3600000)}h old): ${cached.tags.slice(0, 5).join(", ")}...`);
                return cached.tags.slice(0, limit);
            }
        }
    } catch (_) {}

    const youtube = buildYouTubeClient();
    if (!youtube) {
        logger.info("TrendingTags", "YOUTUBE_API_KEY not set — using base viral tags. Add a browser API key in Railway to enable trending tags.");
        return [];
    }

    logger.info("TrendingTags", "Fetching trending tags from YouTube (US, GB, IN)...");

    const [usTags, gbTags, inTags] = await Promise.all([
        fetchRegionTags(youtube, "US"),
        fetchRegionTags(youtube, "GB"),
        fetchRegionTags(youtube, "IN"),
    ]);

    // Count frequency across all regions
    const freq = {};
    for (const tag of [...usTags, ...gbTags, ...inTags]) {
        freq[tag] = (freq[tag] || 0) + 1;
    }

    // Sort by frequency, deduplicate, take top results
    const ranked = Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .map(([tag]) => tag)
        .slice(0, 50);

    logger.info("TrendingTags", `Top trending: ${ranked.slice(0, 8).join(", ")}`);

    // Cache result
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify({ timestamp: Date.now(), tags: ranked }));
    } catch (_) {}

    return ranked.slice(0, limit);
}

module.exports = { getTrendingTags };
