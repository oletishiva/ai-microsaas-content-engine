#!/usr/bin/env node
/**
 * Test video generation with text overlay (single block, 20%-70% band).
 * No API keys needed – uses mock images and silent audio.
 *
 * Usage: node scripts/test-video-overlay.js
 * Creates: output/test_overlay_local.mp4
 */

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const { OUTPUT_DIR, MEDIA_DIR } = require("../config/paths");
const { generateVideo } = require("../src/services/videoGenerator");

async function main() {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

    // 1. Create 3 test images (gradient/color)
    const imagePaths = [];
    for (let i = 0; i < 3; i++) {
        const p = path.join(MEDIA_DIR, `test_img_${i}.jpg`);
        execSync(
            `ffmpeg -f lavfi -i color=c=navy:s=1080x1920:d=1 -frames:v 1 -y "${p}"`,
            { stdio: "pipe" }
        );
        imagePaths.push(p);
    }

    // 2. Create 15s silent audio
    const audioPath = path.join(OUTPUT_DIR, "test_audio.aac");
    execSync(
        `ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 15 -c:a aac "${audioPath}"`,
        { stdio: "pipe" }
    );

    const script = "Most people scroll past this. But you stopped. That means you're ready to level up your marketing.";
    const hookText = "STOP SCROLLING";

    console.log("\n--- Testing video overlay (single text, 20%-70% band) ---\n");

    const outputPath = await generateVideo(
        imagePaths,
        audioPath,
        script,
        hookText,
        "test_overlay_local.mp4"
    );

    console.log("\n✅ Success! Video:", outputPath);
    console.log("   Open the file to verify: text from start, positioned 20% from top.\n");
}

main().catch((err) => {
    console.error("\n❌ Test failed:", err.message);
    process.exit(1);
});
