/**
 * src/services/musicFetcher.js
 * ----------------------------
 * Fetches royalty-free background music from Pixabay Music API.
 * Returns local path to downloaded MP3.
 *
 * Requires: PIXABAY_API_KEY (free at pixabay.com/api/docs/)
 */

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { OUTPUT_DIR } = require("../../config/paths");
const logger = require("../../utils/logger");

/** Map topic keywords to music search terms */
const THEME_TO_MUSIC = {
    motivation: "motivation inspirational",
    motivational: "motivation inspirational",
    gratitude: "calm peaceful",
    believe: "inspirational uplifting",
    success: "corporate uplifting",
    life: "ambient calm",
    morning: "calm peaceful",
    inspiration: "inspirational",
    default: "ambient background",
};

function getMusicQuery(topic = "") {
    const lower = String(topic).toLowerCase();
    for (const [key, query] of Object.entries(THEME_TO_MUSIC)) {
        if (key !== "default" && lower.includes(key)) return query;
    }
    return THEME_TO_MUSIC.default;
}

/**
 * Fetch a random music track from Pixabay by theme.
 * @param {string} theme - Topic or theme (e.g. "motivation", "gratitude")
 * @returns {Promise<string|null>} - Local path to MP3, or null if failed/skipped
 */
async function fetchBackgroundMusic(theme = "") {
    const apiKey = process.env.PIXABAY_API_KEY?.trim();
    if (!apiKey) {
        logger.info("MusicFetcher", "PIXABAY_API_KEY not set – skipping background music");
        return null;
    }

    const query = getMusicQuery(theme);
    const url = `https://pixabay.com/api/music/?key=${apiKey}&q=${encodeURIComponent(query)}&per_page=20`;

    try {
        const res = await axios.get(url, { timeout: 10000 });
        const hits = res.data?.hits || [];
        if (hits.length === 0) {
            logger.warn("MusicFetcher", `No music found for "${query}"`);
            return null;
        }

        // Pick random track (Pixabay may use preview_url, previewURL, or url)
        const track = hits[Math.floor(Math.random() * hits.length)];
        const audioUrl = track.preview_url || track.previewURL || track.url || track.preview?.url;
        if (!audioUrl) {
            logger.warn("MusicFetcher", "Track has no preview URL");
            return null;
        }

        const filename = `music_${Date.now()}_${track.id || "track"}.mp3`;
        const outputPath = path.join(OUTPUT_DIR, filename);
        const response = await axios.get(audioUrl, { responseType: "arraybuffer", timeout: 15000 });
        fs.writeFileSync(outputPath, response.data);

        logger.info("MusicFetcher", `Downloaded: ${track.tags || track.id || "track"}`);
        return outputPath;
    } catch (err) {
        logger.warn("MusicFetcher", "Failed to fetch music:", err.message);
        return null;
    }
}

module.exports = { fetchBackgroundMusic, getMusicQuery };
