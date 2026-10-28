/**
 * utils/bootstrap.js
 * ------------------
 * Makes the app work out of the box on a customer's machine.
 *  - Puts the bundled FFmpeg/FFprobe (npm: ffmpeg-static, ffprobe-static) on PATH,
 *    so users never have to install FFmpeg themselves. Falls back to a system install.
 *  - Loads .env.
 * Require this FIRST in every entry point.
 */

const path = require("path");
const fs = require("fs");

require("dotenv").config();

function prependToPath(dir) {
    if (!dir || !fs.existsSync(dir)) return;
    const parts = (process.env.PATH || "").split(path.delimiter);
    if (!parts.includes(dir)) process.env.PATH = [dir, ...parts].join(path.delimiter);
}

function setupFfmpeg() {
    let source = "system";
    try {
        const ffmpegPath = require("ffmpeg-static");
        if (ffmpegPath && fs.existsSync(ffmpegPath)) {
            prependToPath(path.dirname(ffmpegPath));
            process.env.FFMPEG_PATH = ffmpegPath;
            source = "bundled";
        }
    } catch (_) { /* optional dependency missing – rely on system ffmpeg */ }
    try {
        const probePath = require("ffprobe-static").path;
        if (probePath && fs.existsSync(probePath)) {
            prependToPath(path.dirname(probePath));
            process.env.FFPROBE_PATH = probePath;
        }
    } catch (_) { /* same as above */ }
    return source;
}

const ffmpegSource = setupFfmpeg();

module.exports = { ffmpegSource };
