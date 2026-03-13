#!/usr/bin/env node
/**
 * ALTERNATIVE overlay test – ChatGPT's simpler pipeline.
 * Uses lt(t,2.2) / gte(t,2.2) for enable. Does NOT touch main videoGenerator.
 *
 * Usage: node scripts/test-video-overlay-alt.js
 * Creates: output/test_overlay_alt.mp4
 *
 * With ELEVENLABS_API_KEY set: uses real voice (ElevenLabs).
 * Without: uses silent audio.
 *
 * Compare with: node scripts/test-video-overlay.js → test_overlay_local.mp4
 */

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { execSync } = require("child_process");
const { OUTPUT_DIR, MEDIA_DIR } = require("../config/paths");
const { buildConcatFile, getAudioDuration } = require("../utils/ffmpegHelper");
const { renderTextToImage } = require("../utils/textToImage");
const { generateVoice } = require("../src/services/voiceGenerator");

const HOOK_DURATION = 2.2;
const W = 720;
const H = 1280;

async function generateVideoAlt(imagePaths, audioPath, script, hookText, outputFilename) {
    const videoDuration = await getAudioDuration(audioPath).catch(() => 15);
    const durationPerImage = videoDuration / imagePaths.length;

    const concatPath = buildConcatFile(imagePaths, durationPerImage, OUTPUT_DIR);
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    const hookImg = path.join(OUTPUT_DIR, `alt_hook_${Date.now()}.png`);
    const quoteImg = path.join(OUTPUT_DIR, `alt_quote_${Date.now()}.png`);

    await renderTextToImage(hookText, hookImg, { fontSize: 70, videoWidth: W });
    await renderTextToImage(script, quoteImg, { fontSize: 48, videoWidth: W });

    // setpts=PTS-STARTPTS + fps=25 normalizes timeline so overlay t matches real seconds
    const filter = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-ow)/2:(ih-oh)/2,setsar=1,setpts=PTS-STARTPTS,fps=25[base];[1:v]scale=${W}:-1,format=rgba,setpts=PTS-STARTPTS[hook];[2:v]scale=${W}:-1,format=rgba,setpts=PTS-STARTPTS[quote];[base][hook]overlay=x=(W-w)/2:y=H*0.15:enable='lt(t,${HOOK_DURATION})'[tmp];[tmp][quote]overlay=x=(W-w)/2:y=H*0.35:enable='gte(t,${HOOK_DURATION})'[out]`;

    const args = [
        "-y",
        "-f", "concat", "-safe", "0", "-i", concatPath,
        "-loop", "1", "-i", hookImg,
        "-loop", "1", "-i", quoteImg,
        "-i", audioPath,
        "-filter_complex", filter,
        "-map", "[out]", "-map", "3:a",
        "-t", String(videoDuration),
        "-r", "25",
        "-s", `${W}x${H}`,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "28",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        outputPath,
    ];

    const result = spawnSync("ffmpeg", args, { stdio: "pipe", maxBuffer: 50 * 1024 * 1024 });

    try {
        if (fs.existsSync(hookImg)) fs.unlinkSync(hookImg);
        if (fs.existsSync(quoteImg)) fs.unlinkSync(quoteImg);
        if (fs.existsSync(concatPath)) fs.unlinkSync(concatPath);
    } catch (_) {}

    if (result.status !== 0) {
        throw new Error((result.stderr || "").toString() || "FFmpeg failed");
    }

    return outputPath;
}

async function main() {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

    const imagePaths = [];
    for (let i = 0; i < 3; i++) {
        const p = path.join(MEDIA_DIR, `test_img_alt_${i}.jpg`);
        execSync(`ffmpeg -f lavfi -i color=c=navy:s=1080x1920:d=1 -frames:v 1 -y "${p}"`, { stdio: "pipe" });
        imagePaths.push(p);
    }

    const script = "Most people scroll past this. But you stopped. That means you're ready to level up your marketing.";
    const hookText = "STOP SCROLLING";

    let audioPath;
    const hasVoice = !!process.env.ELEVENLABS_API_KEY?.trim();
    if (hasVoice) {
        const fullNarration = `${hookText}. ${script}`;
        const voicePath = await generateVoice(fullNarration);
        audioPath = voicePath; // MP3 – FFmpeg accepts it
        console.log("Using ElevenLabs voice");
    } else {
        audioPath = path.join(OUTPUT_DIR, "test_audio_alt.aac");
        execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 15 -c:a aac "${audioPath}"`, { stdio: "pipe" });
        console.log("Using silent audio (set ELEVENLABS_API_KEY for real voice)");
    }

    console.log("\n--- Testing ALTERNATIVE overlay (lt/gte, hook 2.2s) ---\n");

    const outputPath = await generateVideoAlt(
        imagePaths,
        audioPath,
        script,
        hookText,
        "test_overlay_alt.mp4"
    );

    console.log("\n✅ Alt test success! Video:", outputPath);
    console.log("   Compare with test_overlay_local.mp4 (existing pipeline)\n");
}

main().catch((err) => {
    console.error("\n❌ Alt test failed:", err.message);
    process.exit(1);
});
