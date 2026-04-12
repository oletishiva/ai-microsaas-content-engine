/**
 * utils/audioMixer.js
 * --------------------
 * Mixes voice narration with background music, or uses music-only when no voice.
 * Music is always trimmed to 15s–35s segment (20s max) from each track.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const logger = require("./logger");
const { getAudioDuration } = require("./ffmpegHelper");

/** Music segment: from 15s to 35s (20 seconds) of each track */
const MUSIC_START = 15;
const MUSIC_SEGMENT_LEN = 20;

/**
 * Mix voice + background music. Output duration = voice duration (shortest).
 * Music is trimmed to 15s–35s segment. When musicOnly: use full volume.
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
    const duration = await getAudioDuration(voicePath);
    const trimDuration = Math.min(MUSIC_SEGMENT_LEN, duration);

    if (musicOnly) {
        // -ss 15: start at 15s. -t trimDuration: take up to 20s (or video length)
        const cmd = `ffmpeg -y -ss ${MUSIC_START} -i "${musicPath}" -t ${trimDuration} -af "volume=1" -ac 2 -ar 44100 -q:a 4 "${outputPath}"`;
        logger.info("AudioMixer", `Using music only (15s–35s segment), ${trimDuration.toFixed(1)}s`);
        try {
            execSync(cmd, { stdio: "pipe", maxBuffer: 10 * 1024 * 1024 });
            logger.info("AudioMixer", `Music audio saved: ${path.basename(outputPath)}`);
            return outputPath;
        } catch (err) {
            const stderr = (err.stderr || err.stdout || "").toString();
            throw new Error(`Music trim failed: ${stderr.slice(-500)}`);
        }
    }

    // Voice + music: extract 15–35s from music, mix at 20%
    const filter = `[0:a]volume=1[a0];[1:a]atrim=0:${trimDuration},asetpts=PTS-STARTPTS,volume=0.2[a1];[a0][a1]amix=inputs=2:duration=shortest:dropout_transition=0`;
    const cmd = `ffmpeg -y -i "${voicePath}" -ss ${MUSIC_START} -i "${musicPath}" -filter_complex "${filter}" -ac 2 -ar 44100 -q:a 4 "${outputPath}"`;

    logger.info("AudioMixer", "Mixing voice + music (15s–35s segment)...");
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
