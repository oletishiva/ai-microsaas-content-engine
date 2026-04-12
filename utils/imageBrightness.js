/**
 * utils/imageBrightness.js
 * ------------------------
 * Detects average brightness of an image using Sharp.
 * Used to auto-select text color: dark image → white text, light image → black text.
 */

const sharp = require("sharp");

/**
 * Returns 'white' or 'black' text color based on the image's average brightness.
 * Samples a 100×100 thumbnail for speed.
 * @param {string} imagePath - Absolute path to the image file
 * @returns {Promise<'white'|'black'>}
 */
async function getImageTextColor(imagePath) {
    try {
        const stats = await sharp(imagePath)
            .resize(100, 100, { fit: "fill" })
            .toColorspace("srgb")
            .stats();

        const rgbChannels = stats.channels.slice(0, 3);
        const brightness = rgbChannels.reduce((sum, ch) => sum + ch.mean, 0) / rgbChannels.length;

        // > 128 = light image → use black text for contrast
        return brightness > 128 ? "black" : "white";
    } catch {
        return "white"; // safe fallback
    }
}

module.exports = { getImageTextColor };
