/**
 * utils/audioMixer.js
 * --------------------
 * Mixes voice narration with background music, or uses music-only when no voice.
 * Voice at full volume, music at ~20% when mixed. Music at 100% when no voice.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const logger = require("./logger");
const { getAudioDuration } = require("./ffmpegHelper");

/**
 * Mix voice + background music. Output duration = voice duration (shortest).
 * When musicOnly=true (no voice): use music at full volume, trim to duration.
 * @param {string} voicePath - Path to voice MP3 (or silent audio)
 * @param {string} musicPath - Path to music MP3
 * @param {string} outputPath - Path for mixed output
 * @param {Object} [opts] - { musicOnly: boolean } - true when no voice (E2E_SKIP_VOICE)
 * @returns {Promise<string>} - outputPath
 */
async function mixVoiceWithMusic(voicePath, musicPath, outputPath, opts = {}) {
    if (!fs.existsSync(voicePath)) throw new Error(`Voice file not found: ${voicePath}`);
    if (!fs.existsSync(musicPath)) throw new Error(`Music file not found: ${musicPath}`);

    const musicOnly = opts.musicOnly === true;

    if (musicOnly) {
        const duration = await getAudioDuration(voicePath);
        const cmd = `ffmpeg -y -i "${musicPath}" -t ${duration} -af "volume=1" -ac 2 -ar 44100 -q:a 4 "${outputPath}"`;
        logger.info("AudioMixer", `Using music only (no voice), ${duration.toFixed(1)}s`);
        try {
            execSync(cmd, { stdio: "pipe", maxBuffer: 10 * 1024 * 1024 });
            logger.info("AudioMixer", `Music audio saved: ${path.basename(outputPath)}`);
            return outputPath;
        } catch (err) {
            const stderr = (err.stderr || err.stdout || "").toString();
            throw new Error(`Music trim failed: ${stderr.slice(-500)}`);
        }
    }

    // amix: voice=1, music=0.2. duration=shortest = output length = voice length
    const filter = `[0:a]volume=1[a0];[1:a]volume=0.2[a1];[a0][a1]amix=inputs=2:duration=shortest:dropout_transition=0`;
    const cmd = `ffmpeg -y -i "${voicePath}" -i "${musicPath}" -filter_complex "${filter}" -ac 2 -ar 44100 -q:a 4 "${outputPath}"`;

    logger.info("AudioMixer", "Mixing voice + music...");
    try {
        execSync(cmd, { stdio: "pipe", maxBuffer: 10 * 1024 * 1024 });
        logger.info("AudioMixer", `Mixed audio saved: ${path.basename(outputPath)}`);
        return outputPath;
    } catch (err) {
        const stderr = (err.stderr || err.stdout || "").toString();
        throw new Error(`Audio mix failed: ${stderr.slice(-500)}`);
    }
}

module.exports = { mixVoiceWithMusic };
