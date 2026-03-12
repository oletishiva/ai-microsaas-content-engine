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
const { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID } = require("../../config/apiKeys");
const { OUTPUT_DIR } = require("../../config/paths");
const logger = require("../../utils/logger");

/**
 * generateVoice
 * @param {string} script - The narration text to convert to speech
 * @returns {Promise<string>} - Absolute path to the saved MP3 file
 */
async function generateVoice(script) {
    if (!ELEVENLABS_API_KEY) {
        throw new Error("ELEVENLABS_API_KEY is not set in .env");
    }
    if (!script || script.trim() === "") {
        throw new Error("Script is empty – cannot generate voice");
    }
    logger.info("VoiceGenerator", "Sending script to ElevenLabs TTS...");

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`;

    try {
        const response = await axios.post(
            url,
            {
                text: script,
                model_id: "eleven_multilingual_v2", // Current default, supports English + 28 languages
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75,
                },
            },
            {
                headers: {
                    "xi-api-key": ELEVENLABS_API_KEY,
                    "Content-Type": "application/json",
                },
                responseType: "arraybuffer",
            }
        );

        // Write the audio buffer to disk
        const outputPath = path.join(OUTPUT_DIR, "narration.mp3");
        fs.writeFileSync(outputPath, response.data);

        logger.info("VoiceGenerator", `Narration saved to: ${outputPath}`);
        return outputPath;
    } catch (err) {
        const detail = err.response?.data?.detail || err.response?.data?.message;
        const status = err.response?.status;
        logger.error("VoiceGenerator", "ElevenLabs TTS error", err);
        let msg = err.message;
        if (status === 401) {
            msg = "ElevenLabs API key invalid or expired. Check your key at elevenlabs.io → Profile → API Key. Regenerate if needed.";
        } else if (detail) {
            msg = detail;
        }
        throw new Error(`Voice generation failed: ${msg}`);
    }
}

module.exports = { generateVoice };
