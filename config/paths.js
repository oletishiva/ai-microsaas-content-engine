/**
 * config/paths.js
 * ---------------
 * Central path configuration for cross-platform and cloud deployment.
 * Uses process.cwd() so paths work on Railway, Heroku, and local dev.
 */

const path = require("path");

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "output");
const MEDIA_DIR = path.join(OUTPUT_DIR, "media");
const MUSIC_DIR = path.join(ROOT, "music");

module.exports = { ROOT, OUTPUT_DIR, MEDIA_DIR, MUSIC_DIR };
