/**
 * src/services/voiceGenerator.js
 * --------------------------------
 * STEP 2 of the pipeline: Convert the script text into spoken
 * audio using the ElevenLabs Text-to-Speech REST API.
 *
 * Input  : script (string) – the narration text from scriptGenerator
 * Output : saves /output/narration.mp3 to disk, returns the file path
 *
 * Workshop note:
 *  - We call the ElevenLabs /text-to-speech endpoint directly with axios.
 *  - The response is streamed as binary (arraybuffer) and written to disk.
 *  - Voice ID controls which voice is used – swap it in .env to change voice.
 */

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { OUTPUT_DIR } = require("../../config/paths");
const logger = require("../../utils/logger");

const VOICE_ID = (process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL").trim();

/**
 * generateVoice
 * @param {string} script - The narration text to convert to speech
 * @returns {Promise<string>} - Absolute path to the saved MP3 file
 */
async function generateVoice(script) {
    const apiKey = (process.env.ELEVENLABS_API_KEY || "").trim();
    if (!apiKey) {
        throw new Error("ELEVENLABS_API_KEY is not set in .env");
    }
    if (!script || script.trim() === "") {
        throw new Error("Script is empty – cannot generate voice");
    }
    logger.info("VoiceGenerator", "Sending script to ElevenLabs TTS...");

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`;

    try {
        const response = await axios.post(
            url,
            {
                text: script,
                model_id: "eleven_multilingual_v2",
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75,
                },
            },
            {
                headers: {
                    "xi-api-key": apiKey,
                    "Content-Type": "application/json",
                },
                responseType: "arraybuffer",
            }
        );

        const outputPath = path.join(OUTPUT_DIR, "narration.mp3");
        fs.writeFileSync(outputPath, response.data);

        logger.info("VoiceGenerator", `Narration saved to: ${outputPath}`);
        return outputPath;
    } catch (err) {
        const data = err.response?.data;
        const status = err.response?.status;
        let msg = err.message;
        if (data && typeof data === "object" && !Buffer.isBuffer(data)) {
            msg = data.detail?.message || data.detail || data.message || JSON.stringify(data);
        } else if (data && (typeof data === "string" || Buffer.isBuffer(data))) {
            try {
                const parsed = JSON.parse(Buffer.isBuffer(data) ? data.toString() : data);
                msg = parsed?.detail?.message || parsed?.detail || parsed?.message || JSON.stringify(parsed);
            } catch (_) {
                msg = String(data).slice(0, 200);
            }
        }
        logger.error("VoiceGenerator", "ElevenLabs TTS error", { status, msg });
        throw new Error(`Voice generation failed: ${msg}`);
    }
}

module.exports = { generateVoice };
