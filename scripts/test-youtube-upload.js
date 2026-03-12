#!/usr/bin/env node
/**
 * scripts/test-youtube-upload.js
 * -------------------------------
 * Tests YouTube upload WITHOUT running the full pipeline.
 * Uses FFmpeg to create a tiny 2-second test video (no OpenAI/ElevenLabs/Pexels).
 * YouTube API has free quota – this only consumes ~1600 units per upload.
 *
 * Usage: node scripts/test-youtube-upload.js
 */

require("dotenv").config();
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { uploadToYouTube } = require("../src/services/youtubeUploader");
const apiKeys = require("../config/apiKeys");

const OUTPUT_DIR = path.join(__dirname, "../output");
const TEST_VIDEO = path.join(OUTPUT_DIR, "youtube-test-video.mp4");

async function main() {
    if (!apiKeys.hasYouTubeConfig) {
        console.error("\n❌ YouTube credentials not configured in .env");
        console.error("   Run: node scripts/get-youtube-refresh-token.js first\n");
        process.exit(1);
    }

    console.log("\n📹 Creating 2-second test video with FFmpeg (no external APIs)...\n");

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    try {
        // Create minimal 1080x1920 vertical video – 2 seconds, black frame
        execSync(
            `ffmpeg -f lavfi -i color=c=black:s=1080x1920:d=2 -c:v libx264 -pix_fmt yuv420p -t 2 -y "${TEST_VIDEO}"`,
            { stdio: "inherit" }
        );
    } catch (err) {
        console.error("\n❌ FFmpeg failed. Is FFmpeg installed? (brew install ffmpeg)");
        process.exit(1);
    }

    console.log("\n📤 Uploading to YouTube (private)...\n");

    try {
        const url = await uploadToYouTube(
            TEST_VIDEO,
            "AI Content Engine – Test Upload",
            "This is a test video from the YouTube integration script. Safe to delete."
        );
        console.log("\n✅ YouTube upload successful!");
        console.log(`   URL: ${url}`);
        console.log("   (Video is private – check your YouTube Studio)\n");
    } catch (err) {
        console.error("\n❌ YouTube upload failed:", err.message);
        if (err.message?.includes("invalid_grant") || err.code === 401) {
            console.error(`
   invalid_grant usually means the refresh token is expired or revoked.
   Fix: Get a fresh token:
   1. Revoke access: https://myaccount.google.com/permissions
   2. Run: npm run youtube:auth
   3. Update YOUTUBE_REFRESH_TOKEN in .env
   4. Ensure YOUTUBE_REDIRECT_URI=http://localhost:3456/oauth2callback
`);
        }
        if (err.response?.data?.error_description) {
            console.error("   Google says:", err.response.data.error_description);
        }
        process.exit(1);
    }
}

main();
