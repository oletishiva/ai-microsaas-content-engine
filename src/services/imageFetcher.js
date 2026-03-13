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
        const trySearch = async (query, orientation, page = 1) => {
            const res = await axios.get("https://api.pexels.com/v1/search", {
                headers: { Authorization: PEXELS_API_KEY },
                params: {
                    query,
                    per_page: 30,
                    page,
                    ...(orientation ? { orientation } : {}),
                },
            });
            return res.data.photos || [];
        };

        // 1. Fetch both orientations – landscape often has more variety; portrait is native 9:16
        let landscape = await trySearch(topic, null);
        let portrait = await trySearch(topic, "portrait");
        logger.info("ImageFetcher", `"${topic}" returned ${landscape.length} landscape, ${portrait.length} portrait`);

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

        // On Railway: use large2x (1880px) instead of original to reduce OOM. Local: original for HD.
        const isRailway = !!process.env.RAILWAY_PROJECT_ID;
        const pickUrl = (src) => (isRailway ? (src?.large2x || src?.large || src?.original) : (src?.original || src?.large2x || src?.large));

        // Only use photos with UNIQUE URLs – Pexels can return same image multiple times
        let urlSeen = new Set();
        let photos = [];
        for (const p of combined) {
            if (photos.length >= count) break;
            const url = pickUrl(p.src) || p.src?.original || p.src?.large2x || p.src?.large;
            if (url && !urlSeen.has(url)) {
                urlSeen.add(url);
                photos.push(p);
            }
        }

        // If still few unique URLs, try page 2
        if (photos.length < count) {
            const beforePage2 = photos.length;
            const page2Portrait = await trySearch(topic, "portrait", 2);
            const page2Landscape = await trySearch(topic, null, 2);
            for (const p of [...page2Portrait, ...page2Landscape]) {
                if (photos.length >= count) break;
                const url = pickUrl(p.src);
                if (url && !urlSeen.has(url)) {
                    urlSeen.add(url);
                    photos.push(p);
                }
            }
            if (photos.length > beforePage2) {
                logger.info("ImageFetcher", `Page 2 added +${photos.length - beforePage2} unique images`);
            }
        }

        // Last resort: search by individual keywords for maximum variety
        if (photos.length < count) {
            const keywords = topic.split(/\s+/).filter((w) => w.length > 2).slice(0, 5);
            for (const kw of keywords) {
                if (photos.length >= count) break;
                const extra = await trySearch(kw, null);
                for (const p of extra) {
                    if (photos.length >= count) break;
                    const url = pickUrl(p.src);
                    if (url && !urlSeen.has(url)) {
                        urlSeen.add(url);
                        photos.push(p);
                    }
                }
            }
            logger.info("ImageFetcher", `Keyword search yielded ${photos.length} unique images`);
        }

        const portraitCount = photos.filter((p) => portrait.some((x) => x.id === p.id)).length;
        const landscapeCount = photos.length - portraitCount;
        logger.info("ImageFetcher", `→ Video will use ${photos.length} images: ${portraitCount} portrait (native 9:16) + ${landscapeCount} landscape (crop to 9:16)`);
        if (photos.length < count) {
            logger.warn("ImageFetcher", `Only ${photos.length}/${count} unique images – video will repeat or have fewer slides`);
        }

        // Verify we have unique URLs (Pexels can return duplicates)
        const urls = photos.map((p) => pickUrl(p.src));
        const uniqueUrls = new Set(urls).size;
        logger.info("ImageFetcher", `URLs: ${uniqueUrls} unique out of ${photos.length}`);
        if (uniqueUrls < photos.length) {
            logger.warn("ImageFetcher", `Pexels returned ${photos.length - uniqueUrls} duplicate image(s) – using ${uniqueUrls} unique`);
        }

        // Download each photo
        const localPaths = [];
        for (let i = 0; i < photos.length; i++) {
            const url = pickUrl(photos[i].src);
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
