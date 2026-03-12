/**
 * config/apiKeys.js
 * -----------------
 * Central place to load and export all environment variables.
 * Keeps API keys out of individual service files and makes
 * it easy to swap keys without hunting through the codebase.
 *
 * Workshop tip: Always validate required keys at startup so
 * you get a clear error instead of a confusing runtime crash.
 */

require("dotenv").config();

/**
 * Validates that required API keys for the core pipeline are present.
 * In production (Railway), we allow startup so the domain is visible; validation happens on first API call.
 * @throws {Error} If any required key is missing (only when not on Railway)
 */
function validateRequiredKeys() {
    const required = [
        { key: "OPENAI_API_KEY", name: "OpenAI" },
        { key: "ELEVENLABS_API_KEY", name: "ElevenLabs" },
        { key: "PEXELS_API_KEY", name: "Pexels" },
    ];
    const optional = [
        { key: "YOUTUBE_CLIENT_ID", name: "YouTube Client ID" },
        { key: "YOUTUBE_CLIENT_SECRET", name: "YouTube Client Secret" },
        { key: "YOUTUBE_REFRESH_TOKEN", name: "YouTube Refresh Token" },
    ];
    const missing = required.filter(({ key }) => !process.env[key] || String(process.env[key]).trim() === "");
    const isRailway = !!process.env.RAILWAY_PROJECT_ID || !!process.env.RAILWAY_PUBLIC_DOMAIN;
    if (missing.length > 0) {
        if (isRailway) {
            console.warn(
                `[apiKeys] Missing: ${missing.map((m) => m.key).join(", ")}. ` +
                    "Add them in Railway → web service → Variables tab. App will start but /api/generate-video will fail."
            );
        } else {
            const list = missing.map((m) => `${m.name} (${m.key})`).join(", ");
            throw new Error(
                `Missing required API keys: ${list}. Add them to .env and restart.`
            );
        }
    }
    const missingOptional = optional.filter(({ key }) => !process.env[key] || String(process.env[key]).trim() === "");
    if (missingOptional.length === optional.length) {
        console.warn("[apiKeys] YouTube credentials not set – uploads will be skipped.");
    }
}

module.exports = {
    validateRequiredKeys,
  // ── Server ────────────────────────────────────────────────
  PORT: process.env.PORT || 3000,

  // ── OpenAI ───────────────────────────────────────────────
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,

  // ── ElevenLabs ───────────────────────────────────────────
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY?.trim() || undefined,
  ELEVENLABS_VOICE_ID: (process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL").trim(),

  // ── Pexels ───────────────────────────────────────────────
  PEXELS_API_KEY: process.env.PEXELS_API_KEY,

  // ── YouTube / Google OAuth2 ───────────────────────────────
  YOUTUBE_CLIENT_ID: process.env.YOUTUBE_CLIENT_ID,
  YOUTUBE_CLIENT_SECRET: process.env.YOUTUBE_CLIENT_SECRET,
  YOUTUBE_REDIRECT_URI: process.env.YOUTUBE_REDIRECT_URI,
  YOUTUBE_REFRESH_TOKEN: process.env.YOUTUBE_REFRESH_TOKEN,

  // E2E test mode: limits ElevenLabs + images to save credits for 1 full pipeline test
  // E2E_TEST_MODE=1 → 15 words max, 2 images. Full upload to YouTube.
  E2E_TEST_MODE: process.env.E2E_TEST_MODE === "1" || process.env.E2E_TEST_MODE === "true",

  // YouTube upload is optional – skip if credentials are placeholder/missing
  hasYouTubeConfig:
    !!process.env.YOUTUBE_CLIENT_ID &&
    !!process.env.YOUTUBE_CLIENT_SECRET &&
    !!process.env.YOUTUBE_REFRESH_TOKEN &&
    process.env.YOUTUBE_CLIENT_ID !== "your_google_client_id_here" &&
    process.env.YOUTUBE_REFRESH_TOKEN !== "your_youtube_refresh_token_here",
};
