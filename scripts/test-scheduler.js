/**
 * scripts/test-scheduler.js
 * --------------------------
 * End-to-end test for one scheduled job — mirrors what scheduler.js does.
 * Uses OpenAI TTS for voice (falls back to silent if it fails).
 * Skips YouTube / Cloudinary upload.
 * Usage: node scripts/test-scheduler.js
 */

require("dotenv").config();

const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const { generateScript } = require("../src/services/scriptGenerator");
const { generateVideo, validatePipeline } = require("../src/services/videoGenerator");
const { fetchBackgroundMusic } = require("../src/services/musicFetcher");
const { mixVoiceWithMusic } = require("../utils/audioMixer");
const { getImageTextColor } = require("../utils/imageBrightness");
const { generateVoiceOpenAI } = require("../utils/openaiTts");
const { OUTPUT_DIR } = require("../config/paths");
const { VIDEO_DURATION } = require("../utils/subtitleHelper");
const apiKeys = require("../config/apiKeys");

const IMAGES_DIR = path.join(__dirname, "../images");

async function testSchedulerJob() {
    const topic = "daily morning motivation";
    const label = "Motivation";
    const voice = "onyx";
    const ts = Date.now();

    console.log(`\n=== SCHEDULER TEST: ${label} (voice: ${voice}) ===\n`);

    // 1. Script
    console.log("Step 1/7 — Generating script via OpenAI...");
    const { script, hook, quote, highlight, title } = await generateScript(topic, false);
    console.log(`  Hook   : "${hook}"`);
    console.log(`  Title  : "${title}"`);
    console.log(`  Script : ${script.slice(0, 70)}...`);

    // 2. Pick 1 random image (matches scheduler behaviour)
    console.log("\nStep 2/7 — Picking 1 random image from /images/...");
    const files = fs.readdirSync(IMAGES_DIR).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));
    if (files.length === 0) throw new Error("No images in /images/ folder");
    const pick = files[Math.floor(Math.random() * files.length)];
    const imagePaths = [path.join(IMAGES_DIR, pick)];
    console.log(`  Using  : ${pick}`);

    // 3. Auto text color
    console.log("\nStep 3/7 — Detecting image brightness...");
    const textColor = await getImageTextColor(imagePaths[0]);
    console.log(`  Text color : ${textColor}`);

    // 4. Validate FFmpeg
    console.log("\nStep 4/7 — Validating FFmpeg pipeline...");
    await validatePipeline(imagePaths);
    console.log("  FFmpeg OK");

    // 5. OpenAI TTS voice (falls back to silent on failure)
    console.log(`\nStep 5/7 — Generating voice with OpenAI TTS (${voice})...`);
    let audioPath;
    const voicePath = path.join(OUTPUT_DIR, `tsched_voice_${ts}.mp3`);
    try {
        await generateVoiceOpenAI(script, voicePath, voice);
        audioPath = voicePath;
        console.log("  Voice OK");
    } catch (err) {
        console.warn(`  TTS failed (${err.message}) — falling back to silent audio`);
        const silentPath = path.join(OUTPUT_DIR, `tsched_silent_${ts}.mp3`);
        execSync(
            `ffmpeg -f lavfi -i anullsrc=r=44100:cl=stereo -t ${VIDEO_DURATION} -q:a 9 -acodec libmp3lame -y "${silentPath}"`,
            { stdio: "pipe" }
        );
        audioPath = silentPath;
    }

    // 6. Mix with music
    let mixedPath = null;
    console.log("\nStep 6/7 — Mixing voice with background music...");
    const musicPath = fetchBackgroundMusic();
    if (musicPath && apiKeys.ADD_MUSIC) {
        mixedPath = path.join(OUTPUT_DIR, `tsched_mixed_${ts}.mp3`);
        await mixVoiceWithMusic(audioPath, musicPath, mixedPath, { musicOnly: false });
        audioPath = mixedPath;
        console.log("  Voice + music mixed OK");
    } else {
        console.log("  No music (ADD_MUSIC disabled or no tracks)");
    }

    // 7. Render video
    console.log("\nStep 7/7 — Rendering video...");
    const outputFilename = `tsched_${label.toLowerCase()}_${ts}.mp4`;
    const videoPath = await generateVideo(imagePaths, audioPath, quote || script, hook, outputFilename, {
        highlight,
        addSubscribeButton: true,
        textColor,
    });
    const sizeKB = (fs.statSync(videoPath).size / 1024).toFixed(0);
    console.log(`  Saved  : ${videoPath}`);
    console.log(`  Size   : ${sizeKB} KB`);

    // Cleanup temp audio
    [voicePath, mixedPath].forEach((p) => {
        try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
    });

    console.log(`\n✅ Scheduler test PASSED`);
    console.log(`   Video at: ${videoPath}`);
    console.log(`   (YouTube + Cloudinary upload skipped in local test)\n`);
}

testSchedulerJob().catch((err) => {
    console.error("\n❌ Test FAILED:", err.message);
    process.exit(1);
});
