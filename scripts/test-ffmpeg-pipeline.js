#!/usr/bin/env node
/**
 * Test FFmpeg pipeline WITHOUT ElevenLabs or OpenAI.
 * Run before your first real pipeline to verify video generation works.
 *
 * Usage: node scripts/test-ffmpeg-pipeline.js
 * Creates: output/test_ffmpeg_ok.mp4 (2-second test)
 */

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const OUTPUT_DIR = path.join(__dirname, "../output");
const MEDIA_DIR = path.join(OUTPUT_DIR, "media");

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

const existingImages = fs.readdirSync(MEDIA_DIR).filter((f) => /\.(jpg|jpeg|png)$/i.test(f));
let imagePath = existingImages.length > 0 ? path.join(MEDIA_DIR, existingImages[0]) : null;

if (!imagePath) {
    console.log("\nCreating test image...\n");
    const testImage = path.join(MEDIA_DIR, "test_image.jpg");
    execSync(`ffmpeg -f lavfi -i color=c=blue:s=1080x1920:d=1 -frames:v 1 -y "${testImage}"`, {
        stdio: "inherit",
    });
    imagePath = testImage;
}

const concatFile = path.join(OUTPUT_DIR, "test_concat.txt");
const outFile = path.join(OUTPUT_DIR, "test_ffmpeg_ok.mp4");

fs.writeFileSync(concatFile, `file '${imagePath}'\nduration 2\nfile '${imagePath}'`);

console.log("Testing FFmpeg (images + audio). No ElevenLabs used.\n");

try {
    execSync(
        `ffmpeg -f concat -safe 0 -i "${concatFile}" -f lavfi -i anullsrc=r=44100:cl=stereo -t 2 ` +
            `-vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,fps=25" ` +
            `-c:v libx264 -preset fast -crf 23 -c:a aac -b:a 192k -pix_fmt yuv420p -shortest -y "${outFile}"`,
        { stdio: "inherit" }
    );

    try {
        fs.unlinkSync(concatFile);
    } catch (_) {}

    console.log("\n✅ FFmpeg OK! Video:", outFile);
    console.log("   Run the full pipeline when ready.\n");
} catch (err) {
    console.error("\n❌ FFmpeg test failed. Fix before running.\n");
    process.exit(1);
}
