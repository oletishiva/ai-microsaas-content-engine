/**
 * utils/ffmpegHelper.js
 * -----------------------
 * Helper utilities used by videoGenerator.js.
 *
 *  • buildConcatFile  – writes the FFmpeg concat text file
 *  • getAudioDuration – probes an audio file and returns its length in seconds
 *
 * Workshop note:
 *  FFmpeg's "concat demuxer" reads a plain text file like:
 *    file '/absolute/path/to/image_0.jpg'
 *    duration 12.4
 *    file '/absolute/path/to/image_1.jpg'
 *    duration 12.4
 *
 *  This is simpler and more reliable than building a complex
 *  filtergraph string for large numbers of inputs.
 */

const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const logger = require("./logger");

/**
 * buildConcatFile
 * Creates the text file used by FFmpeg's concat demuxer to build a
 * slideshow from multiple images.
 *
 * @param {string[]} imagePaths    - Absolute paths to image files
 * @param {number}   durationEach  - Seconds each image should be displayed
 * @param {string}   outputDir     - Directory to save the concat file
 * @returns {string}               - Absolute path to the written concat file
 */
function buildConcatFile(imagePaths, durationEach, outputDir) {
    // Build the concat file content line by line
    const lines = [];
    for (const imgPath of imagePaths) {
        lines.push(`file '${imgPath}'`);
        lines.push(`duration ${durationEach.toFixed(3)}`);
    }

    // FFmpeg requires a final file entry without a duration to avoid
    // a 0-second black frame at the end
    lines.push(`file '${imagePaths[imagePaths.length - 1]}'`);

    const concatFilePath = path.join(outputDir, "concat.txt");
    fs.writeFileSync(concatFilePath, lines.join("\n"));

    logger.info("FFmpegHelper", `Concat file written: ${concatFilePath}`);
    return concatFilePath;
}

/**
 * getAudioDuration
 * Uses FFmpeg's ffprobe to determine the exact duration of an audio file.
 *
 * @param {string} audioPath - Absolute path to the audio file (e.g. .mp3)
 * @returns {Promise<number>} - Duration in seconds (floating point)
 */
function getAudioDuration(audioPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(audioPath, (err, metadata) => {
            if (err) {
                return reject(
                    new Error(`[FFmpegHelper] ffprobe failed: ${err.message}`)
                );
            }

            const duration = metadata.format.duration;

            if (!duration) {
                return reject(
                    new Error("[FFmpegHelper] Could not determine audio duration")
                );
            }

            logger.info("FFmpegHelper", `Audio duration: ${parseFloat(duration).toFixed(2)}s`);
            resolve(parseFloat(duration));
        });
    });
}

module.exports = { buildConcatFile, getAudioDuration };
