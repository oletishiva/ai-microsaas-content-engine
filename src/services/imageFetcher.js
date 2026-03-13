/**
 * src/services/imageFetcher.js
 * ------------------------------
 * STEP 3 of the pipeline: Fetch images from Pexels for Shorts (9:16 vertical).
 *
 * Strategy:
 *  1. Try orientation=portrait first (native vertical, Shorts-ready)
 *  2. Fallback to no-orientation (landscape) – FFmpeg crops to 9:16
 *  3. Short query fallback if few results
 *
 * FFmpeg uses: scale=W:H:force_original_aspect_ratio=increase,crop=W:H
 * to convert landscape → vertical (center crop, no black bars).
 */

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { PEXELS_API_KEY } = require("../../config/apiKeys");
const { MEDIA_DIR } = require("../../config/paths");
const { VIDEO_DURATION } = require("../../utils/subtitleHelper");
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
async function downloadImage(imageUrl, filename, targetDir) {
    const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const filePath = path.resolve(path.join(targetDir, filename));
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
    // Unique dir per request – prevents overwrites from concurrent requests
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const runDir = path.join(MEDIA_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });
    logger.info("ImageFetcher", `Using media dir: ${runId}`);

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

        // 1. Try portrait first (native 9:16 – Shorts-ready)
        let portrait = await trySearch(topic, "portrait");
        logger.info("ImageFetcher", `Portrait "${topic}" returned ${portrait.length} photos`);

        // 2. Fallback: no-orientation (landscape) – we crop to 9:16 in FFmpeg
        let landscape = [];
        if (portrait.length < count) {
            landscape = await trySearch(topic, null);
            logger.info("ImageFetcher", `Adding landscape fallback: +${landscape.length} photos (portrait had ${portrait.length}, need ${count})`);
        } else {
            logger.info("ImageFetcher", `Portrait sufficient (${portrait.length} >= ${count}), skipping landscape`);
        }

        // 3. Short query fallback: "ocean waves" from "beautiful ocean waves sunset"
        const uniqueBeforeShort = new Set([...portrait, ...landscape].map((p) => p.id)).size;
        if (uniqueBeforeShort < count) {
            const shortQuery = topic.split(/\s+/).slice(0, 2).join(" ");
            if (shortQuery !== topic) {
                const more = await trySearch(shortQuery, null);
                const morePortrait = await trySearch(shortQuery, "portrait");
                const added = more.length + morePortrait.length;
                landscape = [...landscape, ...more, ...morePortrait];
                logger.info("ImageFetcher", `Short query "${shortQuery}" added +${added} photos (had ${uniqueBeforeShort} unique, need ${count})`);
            }
        }

        // Prefer portrait first (native 9:16), then fill with landscape (cropped to 9:16 in FFmpeg)
        const seen = new Set();
        const combined = [];
        for (const p of portrait) {
            if (!seen.has(p.id)) {
                combined.push(p);
                seen.add(p.id);
            }
        }
        for (const p of landscape) {
            if (!seen.has(p.id)) {
                combined.push(p);
                seen.add(p.id);
            }
        }

        if (!combined || combined.length === 0) {
            throw new Error(`No images found for topic: "${topic}"`);
        }

        // Only use photos with UNIQUE URLs – Pexels can return same image multiple times
        const urlSeen = new Set();
        const photos = [];
        for (const p of combined) {
            if (photos.length >= count) break;
            const url = p.src?.original || p.src?.large2x || p.src?.large;
            if (url && !urlSeen.has(url)) {
                urlSeen.add(url);
                photos.push(p);
            }
        }
        const portraitCount = photos.filter((p) => portrait.some((x) => x.id === p.id)).length;
        const landscapeCount = photos.length - portraitCount;
        logger.info("ImageFetcher", `→ Video will use ${photos.length} images: ${portraitCount} portrait (native 9:16) + ${landscapeCount} landscape (crop to 9:16)`);
        if (photos.length < count) {
            logger.warn("ImageFetcher", `Only ${photos.length}/${count} images available – video will have fewer slides`);
        }

        // Verify we have unique URLs (Pexels can return duplicates)
        const urls = photos.map((p) => p.src.original || p.src.large2x || p.src.large);
        const uniqueUrls = new Set(urls).size;
        logger.info("ImageFetcher", `URLs: ${uniqueUrls} unique out of ${photos.length}`);
        if (uniqueUrls < photos.length) {
            logger.warn("ImageFetcher", `Pexels returned ${photos.length - uniqueUrls} duplicate image(s) – using ${uniqueUrls} unique`);
        }

        // Download each photo – use original for HD, fallback to large2x then large
        const localPaths = [];
        for (let i = 0; i < photos.length; i++) {
            const src = photos[i].src;
            const url = src.original || src.large2x || src.large;
            const filePath = await downloadImage(url, `image_${i}.jpg`, runDir);
            localPaths.push(filePath);
        }
        logger.info("ImageFetcher", `Downloaded ${localPaths.length} images → video slideshow (${(VIDEO_DURATION / localPaths.length).toFixed(1)}s per image)`);
        return localPaths;
    } catch (err) {
        const msg = err.response?.data?.error || err.message;
        logger.error("ImageFetcher", "Pexels API error", err);
        throw new Error(`Image fetch failed: ${msg}`);
    }
}

module.exports = { fetchImages };
