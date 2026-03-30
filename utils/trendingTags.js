/**
 * utils/trendingTags.js
 * ----------------------
 * Fetches trending tags from top motivation/quotes Shorts on YouTube.
 * Searches for "motivation shorts", "quotes shorts", "mindset shorts" etc.
 * and extracts the most-used tags from those videos.
 *
 * Requires YOUTUBE_API_KEY in .env (a simple browser/server key — not OAuth).
 * Cost: ~100 units per refresh (search costs 100 units each, we do 4 searches).
 * Cache: results saved to /tmp/trending_tags_cache.json and reused for 23h.
 */

const { google } = require("googleapis");
const fs = require("fs");
const logger = require("./logger");

const CACHE_FILE = require("os").tmpdir() + "/trending_tags_cache.json";
const CACHE_TTL_MS = 23 * 60 * 60 * 1000; // 23 hours

/** Search queries targeting our niche — motivation/quotes Shorts */
const NICHE_SEARCHES = [
    "motivation shorts 2025",
    "quotes shorts viral",
    "mindset shorts",
    "life quotes shorts",
];

/** Tags unrelated to motivation/self-help — filter these out */
const BLOCKLIST = new Set([
    "video", "youtube", "2024", "2025", "2026", "new", "best",
    "funny", "gaming", "game", "music", "song", "dance", "comedy",
    "vlog", "challenge", "reaction", "meme", "movie", "film",
    "cricket", "football", "soccer", "nba", "nfl", "sport",
    "roblox", "minecraft", "fortnite", "gameplay", "trailer",
    "review", "tutorial", "howto", "diy", "cooking", "recipe",
    "prank", "kids", "baby", "cute", "animal", "pet",
]);

function buildYouTubeClient() {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) return null;
    return google.youtube({ version: "v3", auth: apiKey });
}

/**
 * Search YouTube for a query, fetch snippet tags from results.
 * @param {object} youtube
 * @param {string} query
 * @returns {Promise<string[]>}
 */
async function fetchSearchTags(youtube, query) {
    try {
        // Search for relevant Shorts (costs 100 quota units)
        const searchRes = await youtube.search.list({
            part: ["id"],
            q: query,
            type: "video",
            videoDuration: "short",
            order: "viewCount",
            maxResults: 20,
            relevanceLanguage: "en",
        });

        const videoIds = (searchRes.data.items || []).map((v) => v.id?.videoId).filter(Boolean);
        if (videoIds.length === 0) return [];

        // Fetch tags from those videos (costs 1 unit)
        const snippetRes = await youtube.videos.list({
            part: ["snippet"],
            id: videoIds.join(","),
        });

        const tags = [];
        for (const item of snippetRes.data.items || []) {
            for (const tag of item.snippet?.tags || []) {
                const clean = tag.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
                if (clean.length >= 3 && clean.length <= 30 && !BLOCKLIST.has(clean)) {
                    tags.push(clean);
                }
            }
        }
        return tags;
    } catch (err) {
        logger.warn("TrendingTags", `Search "${query}" failed: ${err.message}`);
        return [];
    }
}

/**
 * Get top N trending motivation tags from YouTube search.
 * Tags from videos with higher view counts rank higher (order: viewCount).
 * Cached for 23h to stay within quota.
 *
 * @param {number} [limit=15]
 * @returns {Promise<string[]>}
 */
async function getTrendingTags(limit = 15) {
    // Return cached result if fresh
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
            const age = Date.now() - (cached.timestamp || 0);
            if (age < CACHE_TTL_MS && Array.isArray(cached.tags) && cached.tags.length > 0) {
                logger.info("TrendingTags", `Cached tags (${Math.round(age / 3600000)}h old): ${cached.tags.slice(0, 5).join(", ")}`);
                return cached.tags.slice(0, limit);
            }
        }
    } catch (_) {}

    const youtube = buildYouTubeClient();
    if (!youtube) {
        logger.info("TrendingTags", "YOUTUBE_API_KEY not set — using base viral tags. Add key in Railway to enable trending tags.");
        return [];
    }

    logger.info("TrendingTags", `Searching trending motivation tags (${NICHE_SEARCHES.length} queries)...`);

    // Run all searches in parallel
    const results = await Promise.all(NICHE_SEARCHES.map((q) => fetchSearchTags(youtube, q)));
    const allTags = results.flat();

    if (allTags.length === 0) {
        logger.warn("TrendingTags", "No tags found from searches — using base viral tags");
        return [];
    }

    // Frequency rank — tags appearing across multiple searches rank higher
    const freq = {};
    for (const tag of allTags) {
        freq[tag] = (freq[tag] || 0) + 1;
    }

    const ranked = Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .map(([tag]) => tag)
        .slice(0, 50);

    logger.info("TrendingTags", `Top niche trending: ${ranked.slice(0, 8).join(", ")}`);

    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify({ timestamp: Date.now(), tags: ranked }));
    } catch (_) {}

    return ranked.slice(0, limit);
}

module.exports = { getTrendingTags };
