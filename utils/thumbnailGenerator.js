/**
 * utils/thumbnailGenerator.js
 * ---------------------------
 * Creates YouTube thumbnail with Hook text for better preview/attraction.
 * Uses first image + Hook overlay. 1080×1920 (9:16) for Shorts.
 */

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const { renderTextToImage } = require("./textToImage");

const W = 1080;
const H = 1920;

/**
 * Generate thumbnail: first image + Hook text overlay.
 * @param {string} firstImagePath - Path to first video image
 * @param {string} hookText - Hook text for overlay (e.g. "STOP SCROLLING")
 * @param {string} outputPath - Where to save thumbnail (JPEG, <2MB for YouTube)
 * @returns {Promise<string>} outputPath
 */
async function generateThumbnailWithHook(firstImagePath, hookText, outputPath) {
    const hookPngPath = outputPath.replace(/\.[a-z]+$/i, "_hook.png");
    await renderTextToImage(hookText, hookPngPath, {
        fontSize: 72,
        videoWidth: W,
        maxCharsPerLine: 12,
    });

    const ovY = Math.floor(H * 0.15);
    await sharp(firstImagePath)
        .resize(W, H, { fit: "cover", position: "center" })
        .composite([{ input: hookPngPath, left: 0, top: ovY }])
        .jpeg({ quality: 88 })
        .toFile(outputPath);

    try {
        fs.unlinkSync(hookPngPath);
    } catch (_) {}

    return outputPath;
}

module.exports = { generateThumbnailWithHook };
