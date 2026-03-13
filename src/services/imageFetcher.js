/**
 * src/services/imageFetcher.js
 * ------------------------------
 * STEP 3 of the pipeline: Fetch relevant images from the Pexels API
 * and download them to the /output/media/ folder.
 *
 * Input  : topic (string) – used as the search query
 * Output : array of local file paths to the downloaded images
 *
 * Workshop note:
 *  - Pexels returns JSON with photo objects, each having src URLs at
 *    multiple resolutions. We pick "large" for a good quality/size balance.
 *  - We download N images (default 8 for Shorts) to give FFmpeg enough material
 *    for a slideshow that matches the audio length.
 */

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { PEXELS_API_KEY } = require("../../config/apiKeys");
const { MEDIA_DIR } = require("../../config/paths");
const logger = require("../../utils/logger");

/**
 * Ensures the media output directory exists.
 */
function ensureMediaDir() {
    if (!fs.existsSync(MEDIA_DIR)) {
        fs.mkdirSync(MEDIA_DIR, { recursive: true });
    }
}

/**
 * downloadImage
 * Downloads a single image from a URL to the local MEDIA_DIR.
 *
 * @param {string} imageUrl - Direct URL to the image
 * @param {string} filename  - Name to save the file as (e.g. "image_0.jpg")
 * @returns {Promise<string>} - Local path to the saved image
 */
async function downloadImage(imageUrl, filename) {
    const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const filePath = path.resolve(path.join(MEDIA_DIR, filename));
    fs.writeFileSync(filePath, response.data);
    return filePath;
}

/**
 * fetchImages
 * Searches Pexels for photos matching the topic and downloads them.
 *
 * @param {string} topic  - Search query (usually the video topic)
 * @param {number} count  - Number of images to fetch (default 5)
 * @returns {Promise<string[]>} - Array of local file paths
 */
async function fetchImages(topic, count = 8) {
    if (!PEXELS_API_KEY) {
        throw new Error("PEXELS_API_KEY is not set in .env");
    }
    logger.info("ImageFetcher", `Searching Pexels for "${topic}" (${count} images)...`);

    ensureMediaDir();

    try {
        const trySearch = async (query, orientation) => {
            const res = await axios.get("https://api.pexels.com/v1/search", {
                headers: { Authorization: PEXELS_API_KEY },
                params: {
                    query,
                    per_page: 30,
                    ...(orientation ? { orientation } : {}),
                },
            });
            return res.data.photos || [];
        };

        // Try full query first (no orientation = most results)
        let photos = await trySearch(topic, null);
        logger.info("ImageFetcher", `Query "${topic}" returned ${photos.length} photos`);

        // Fallback: if few results, try shorter query (e.g. "ocean waves" from "beautiful ocean waves sunset")
        if (photos.length < count) {
            const shortQuery = topic.split(/\s+/).slice(0, 2).join(" ");
            if (shortQuery !== topic) {
                const more = await trySearch(shortQuery, null);
                logger.info("ImageFetcher", `Fallback "${shortQuery}" returned ${more.length} photos`);
                const seen = new Set(photos.map((p) => p.id));
                for (const p of more) {
                    if (!seen.has(p.id)) {
                        photos.push(p);
                        seen.add(p.id);
                    }
                }
            }
        }

        // Last resort: add portrait results
        if (photos.length < count) {
            const portrait = await trySearch(topic, "portrait");
            const seen = new Set(photos.map((p) => p.id));
            for (const p of portrait) {
                if (!seen.has(p.id)) {
                    photos.push(p);
                    seen.add(p.id);
                }
            }
        }

        if (!photos || photos.length === 0) {
            throw new Error(`No images found for topic: "${topic}"`);
        }

        photos = photos.slice(0, count);
        logger.info("ImageFetcher", `Using ${photos.length} unique photos. Downloading...`);

        // Download each photo – use original for HD, fallback to large2x then large
        const localPaths = [];
        for (let i = 0; i < photos.length; i++) {
            const src = photos[i].src;
            const url = src.original || src.large2x || src.large;
            const filePath = await downloadImage(url, `image_${i}.jpg`);
            logger.info("ImageFetcher", `Downloaded (HD): ${filePath}`);
            localPaths.push(filePath);
        }

        return localPaths;
    } catch (err) {
        const msg = err.response?.data?.error || err.message;
        logger.error("ImageFetcher", "Pexels API error", err);
        throw new Error(`Image fetch failed: ${msg}`);
    }
}

module.exports = { fetchImages };
