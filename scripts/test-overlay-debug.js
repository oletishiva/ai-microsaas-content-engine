/**
 * Debug script: test overlay with raw FFmpeg to isolate the issue.
 * Run: node scripts/test-overlay-debug.js
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { renderTextToImage } = require("../utils/textToImage");
const { OUTPUT_DIR } = require("../config/paths");
const MEDIA_DIR = path.join(OUTPUT_DIR, "media");

async function main() {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    // 1. Create a test overlay PNG
    const overlayPath = path.join(OUTPUT_DIR, "debug_overlay.png");
    await renderTextToImage("TEST HOOK TEXT", overlayPath, { fontSize: 64 });
    console.log("Created overlay:", overlayPath, "size:", fs.statSync(overlayPath).size);

    // 2. Use concat.txt if it exists and references valid images
    const concatPath = path.join(OUTPUT_DIR, "concat.txt");
    if (!fs.existsSync(concatPath)) {
        console.log("No concat.txt. Run a full pipeline first to fetch images.");
        return;
    }
    const concatContent = fs.readFileSync(concatPath, "utf8");
    const firstFile = concatContent.match(/file '([^']+)'/)?.[1];
    if (!firstFile || !fs.existsSync(firstFile)) {
        console.log("Concat references missing files. Run pipeline first.");
        return;
    }
    console.log("Using concat:", concatPath);

    // 3. Create silent audio
    const audioPath = path.join(OUTPUT_DIR, "debug_audio.aac");
    execSync(
        `ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 15 -c:a aac "${audioPath}"`,
        { stdio: "pipe" }
    );

    // 4. Run FFmpeg - overlay WITHOUT enable (should show for full 15s)
    const outPath = path.join(OUTPUT_DIR, "debug_overlay_test.mp4");
    const filter = `[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,fps=25[main];[2:v]format=rgba[ov];[main][ov]overlay=x=(W-w)/2:y=0.75*H-h/2[out]`;

    const cmd = `ffmpeg -y -f concat -safe 0 -i "${concatPath}" -i "${audioPath}" -loop 1 -i "${overlayPath}" -filter_complex "${filter}" -map "[out]" -map 1:a -t 15 -c:v libx264 -preset ultrafast -c:a aac "${outPath}"`;

    console.log("\n--- FFmpeg command ---\n", cmd, "\n---\n");

    try {
        execSync(cmd, { stdio: "inherit" });
        console.log("\nSuccess! Check:", outPath);
    } catch (err) {
        console.error("FFmpeg failed");
    }
}

main().catch(console.error);
