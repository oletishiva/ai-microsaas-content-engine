#!/usr/bin/env node
/**
 * Quick test of ElevenLabs API key.
 * Run: node scripts/test-elevenlabs-key.js
 */

require("dotenv").config();
const axios = require("axios");

const key = process.env.ELEVENLABS_API_KEY?.trim();

if (!key) {
    console.error("\n❌ ELEVENLABS_API_KEY not set in .env\n");
    process.exit(1);
}

console.log("\n🔑 Testing ElevenLabs API key...");
console.log("   Key length:", key.length, "| Starts with:", key.slice(0, 8) + "...\n");

Promise.all([
    axios.get("https://api.elevenlabs.io/v1/user", { headers: { "xi-api-key": key } }),
    axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL?output_format=mp3_44100_128`,
        { text: "Test.", model_id: "eleven_multilingual_v2" },
        { headers: { "xi-api-key": key, "Content-Type": "application/json" }, responseType: "arraybuffer" }
    ),
])
    .then(([userRes]) => {
        console.log("✅ Key is valid! User + TTS both OK.");
    })
    .catch((err) => {
        const detail = err.response?.data?.detail || err.response?.data?.message || err.message;
        console.error("❌ Key rejected:", err.response?.status, typeof detail === "object" ? JSON.stringify(detail) : detail);
        if (err.response?.status === 401) {
            console.error(`
   Get a fresh key:
   1. ElevenLabs → Developers → API Keys
   2. Click "+ Create Key"
   3. Copy the FULL key (shown only once)
   4. Update ELEVENLABS_API_KEY in .env
`);
        }
        process.exit(1);
    });
