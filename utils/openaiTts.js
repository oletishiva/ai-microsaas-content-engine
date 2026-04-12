/**
 * utils/openaiTts.js
 * -------------------
 * OpenAI TTS voice generation — works on Railway (unlike ElevenLabs).
 * Model: tts-1 (~$0.015/1k chars ≈ $0.003 per 35-word script)
 *
 * Voices and their feel:
 *   onyx    — deep, male, authoritative    → Motivation / Success Mindset
 *   nova    — warm, female, energetic      → Affirmation / Test
 *   echo    — clear, male, neutral         → Productivity
 *   fable   — expressive, storytelling     → Life Reflection
 *   shimmer — soft, female, calming        → Night Calm
 *   alloy   — balanced, neutral            → general fallback
 */

const OpenAI = require("openai");
const fs = require("fs");
const logger = require("./logger");

/** Generate voice MP3 using OpenAI TTS. Returns outputPath. */
async function generateVoiceOpenAI(text, outputPath, voice = "nova") {
    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");

    const openai = new OpenAI({ apiKey, timeout: 30_000 });

    logger.info("OpenAITTS", `Generating voice (${voice}) for ${text.split(/\s+/).length} words...`);

    const response = await openai.audio.speech.create({
        model: "tts-1",
        voice,
        input: text,
        response_format: "mp3",
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);

    logger.info("OpenAITTS", `Voice saved: ${outputPath} (${(buffer.length / 1024).toFixed(0)} KB)`);
    return outputPath;
}

module.exports = { generateVoiceOpenAI };
