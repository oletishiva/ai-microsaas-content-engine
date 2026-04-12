/**
 * src/services/musicFetcher.js
 * ----------------------------
 * Reads background music from local ./music/ folder.
 * Add your MP3 files there – one is picked randomly per video.
 */

const fs = require("fs");
const path = require("path");
const { MUSIC_DIR } = require("../../config/paths");
const logger = require("../../utils/logger");

/**
 * Pick a random MP3 from ./music/ folder.
 * @returns {string|null} - Path to MP3, or null if folder empty
 */
function fetchBackgroundMusic() {
    if (!fs.existsSync(MUSIC_DIR)) {
        logger.info("MusicFetcher", `No music folder at ${MUSIC_DIR} – skipping background music`);
        return null;
    }
    const files = fs.readdirSync(MUSIC_DIR).filter((f) => f.toLowerCase().endsWith(".mp3"));
    if (files.length === 0) {
        logger.info("MusicFetcher", `No MP3 files in ${MUSIC_DIR} – add some for background music`);
        return null;
    }
    const chosen = files[Math.floor(Math.random() * files.length)];
    const fullPath = path.join(MUSIC_DIR, chosen);
    logger.info("MusicFetcher", `Using: ${chosen} (${files.length} MP3(s) in ${MUSIC_DIR})`);
    return fullPath;
}

module.exports = { fetchBackgroundMusic };
