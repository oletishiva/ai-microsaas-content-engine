/**
 * src/services/videoGenerator.js
 * --------------------------------
 * STEP 4: Assemble 15-second vertical (1080×1920) marketing videos.
 * Text overlays (hook + subtitles) are optional - require FFmpeg with libfreetype.
 */

const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const { OUTPUT_DIR } = require("../../config/paths");
const { buildConcatFile } = require("../../utils/ffmpegHelper");
const { getSubtitleSegments, VIDEO_DURATION } = require("../../utils/subtitleHelper");
const { renderTextToImage } = require("../../utils/textToImage");
const logger = require("../../utils/logger");
const HOOK_DURATION = 2;

/**
 * Write text to file for drawtext textfile option
 */
function writeTextFile(dir, prefix, text) {
    const filePath = path.join(dir, `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
    fs.writeFileSync(filePath, String(text || "").trim(), "utf8");
    return filePath;
}

/**
 * Build drawtext filter using textfile
 */
function buildDrawTextFilter(textFilePath, fontSize, yExpr, enableExpr) {
    const safePath = textFilePath.replace(/\\/g, "/");
    return `drawtext=textfile='${safePath}':fontsize=${fontSize}:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=${yExpr}:enable='${enableExpr}'`;
}

/**
 * Run FFmpeg with image overlays using raw exec (bypasses fluent-ffmpeg for reliability)
 */
function runFfmpegWithOverlays(concatPath, audioPath, overlayPaths, baseFilters, outputPath, outputOpts, cleanup) {
    const { spawnSync } = require("child_process");

    const baseFilterStr = baseFilters.join(",");
    let prevLabel = "main";
    const filterParts = [`[0:v]${baseFilterStr}[main]`];

    for (let idx = 0; idx < overlayPaths.length; idx++) {
        const o = overlayPaths[idx];
        const inIdx = idx + 2;
        const outLabel = idx === overlayPaths.length - 1 ? "out" : `v${idx}`;
        // Bottom-anchor so text stays in frame: y = H - h - margin
        const yExpr = `H-h-40`;
        const enableExpr = `between(t\\,${o.start}\\,${o.end})`;
        filterParts.push(
            `[${inIdx}:v]format=rgba[ov${idx}];[${prevLabel}][ov${idx}]overlay=x=(W-w)/2:y=${yExpr}:enable='${enableExpr}'[${outLabel}]`
        );
        prevLabel = outLabel;
    }

    const filterComplex = filterParts.join(";");
    const loopInputs = overlayPaths.flatMap((o) => ["-loop", "1", "-i", o.path]);

    const args = [
        "-y",
        "-f", "concat", "-safe", "0", "-i", concatPath,
        "-i", audioPath,
        ...loopInputs,
        "-filter_complex", filterComplex,
        "-map", "[out]", "-map", "1:a",
        ...outputOpts,
        outputPath,
    ];

    return new Promise((resolve, reject) => {
        try {
            logger.info("VideoGenerator", "FFmpeg encoding started (image overlays)");
            const result = spawnSync("ffmpeg", args, {
                stdio: "pipe",
                maxBuffer: 50 * 1024 * 1024,
            });
            if (result.status !== 0) {
                const stderr = (result.stderr || "").toString();
                throw new Error(stderr || `FFmpeg exited ${result.status}`);
            }
            cleanup();
            logger.info("VideoGenerator", `Video saved: ${outputPath}`);
            resolve(outputPath);
        } catch (err) {
            cleanup();
            logger.error("VideoGenerator", "FFmpeg error", err);
            reject(new Error(`Video generation failed: ${err.message}`));
        }
    });
}

/**
 * Check if drawtext filter is available
 */
function hasDrawTextFilter() {
    try {
        const { execSync } = require("child_process");
        const out = execSync("ffmpeg -filters 2>&1", { encoding: "utf8" });
        return out.includes("drawtext");
    } catch {
        return false;
    }
}

/**
 * generateVideo
 */
async function generateVideo(imagePaths, audioPath, script, hookText, outputFilename) {
    if (!imagePaths || imagePaths.length === 0) {
        throw new Error("No image paths provided");
    }
    if (!audioPath || !fs.existsSync(audioPath)) {
        throw new Error(`Audio file not found: ${audioPath}`);
    }

    logger.info("VideoGenerator", `Rendering 15s video with ${imagePaths.length} images (${(VIDEO_DURATION / imagePaths.length).toFixed(1)}s per slide)...`);

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const tempFiles = [];
    const cleanup = () => {
        tempFiles.forEach((f) => {
            try {
                if (fs.existsSync(f)) fs.unlinkSync(f);
            } catch (_) {}
        });
    };

    const durationPerImage = VIDEO_DURATION / imagePaths.length;
    const concatFilePath = buildConcatFile(imagePaths, durationPerImage, OUTPUT_DIR);
    const outputPath = path.join(OUTPUT_DIR, outputFilename);
    tempFiles.push(concatFilePath);

    const useDrawText = hasDrawTextFilter();
    const useImageOverlay = !useDrawText;
    if (useImageOverlay) {
        logger.info("VideoGenerator", "Using image overlay (FFmpeg lacks drawtext).");
    }

    // Shorts: 1080×1920 portrait (9:16). Use 720×1280 on Railway to reduce OOM (SIGKILL)
    const isRailway = !!process.env.RAILWAY_PROJECT_ID;
    const W = isRailway ? 720 : 1080;
    const H = isRailway ? 1280 : 1920;
    // Crop to fill + subtle Ken Burns zoom (images feel dynamic)
    let baseFilters = [
        `scale=${W}:${H}:force_original_aspect_ratio=increase`,
        `crop=${W}:${H}:(iw-ow)/2:(ih-oh)/2`,
        `zoompan=z='min(zoom+0.0012,1.08)':d=1:s=${W}x${H}:fps=25`,
        "setsar=1",
        "fps=25",
    ];

    if (useDrawText) {
        const hookFile = writeTextFile(OUTPUT_DIR, "hook", hookText || "STOP MAKING THIS MISTAKE");
        tempFiles.push(hookFile);
        baseFilters.push(buildDrawTextFilter(hookFile, 64, "h*0.75", `between(t,0,${HOOK_DURATION})`));
        const subtitleSegments = getSubtitleSegments(script);
        subtitleSegments.forEach((s, i) => {
            const f = writeTextFile(OUTPUT_DIR, `sub${i}`, s.text);
            tempFiles.push(f);
            baseFilters.push(buildDrawTextFilter(f, 48, "h*0.85", `between(t,${s.start},${s.end})`));
        });
    }

    const outputOpts = [
        "-t", "15",
        "-s", `${W}x${H}`,
        "-aspect", "9:16",
        "-metadata:s:v:0", "rotate=0",
        "-c:v", "libx264",
        "-preset", isRailway ? "ultrafast" : "fast",
        "-threads", "1",
        "-max_muxing_queue_size", "1024",
        "-crf", isRailway ? "28" : "23",
        "-c:a", "aac",
        "-b:a", "192k",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-avoid_negative_ts", "make_zero",
    ];

    const cmd = ffmpeg()
        .input(concatFilePath)
        .inputOptions(["-f concat", "-safe 0"])
        .input(audioPath);

    if (useDrawText) {
        cmd.videoFilters(baseFilters);
    } else if (useImageOverlay && (hookText || script)) {
        const ts = Date.now();
        const overlayPaths = [];
        const subtitleSegments = getSubtitleSegments(script);

        const overlayOpts = { videoWidth: W };
        if (hookText) {
            const hookPath = path.join(OUTPUT_DIR, `overlay_hook_${ts}.png`);
            await renderTextToImage(hookText, hookPath, { fontSize: 56, ...overlayOpts });
            overlayPaths.push({ path: hookPath, start: 0, end: HOOK_DURATION });
            tempFiles.push(hookPath);
        }
        for (let i = 0; i < subtitleSegments.length; i++) {
            const s = subtitleSegments[i];
            const subPath = path.join(OUTPUT_DIR, `overlay_sub${i}_${ts}.png`);
            await renderTextToImage(s.text, subPath, { fontSize: 48, ...overlayOpts });
            overlayPaths.push({ path: subPath, start: s.start, end: s.end });
            tempFiles.push(subPath);
        }

        if (overlayPaths.length > 0) {
            return runFfmpegWithOverlays(
                concatFilePath,
                audioPath,
                overlayPaths,
                baseFilters,
                outputPath,
                outputOpts,
                cleanup,
            );
        } else {
            cmd.videoFilters(baseFilters);
            cmd.outputOptions(outputOpts);
        }
    } else {
        cmd.videoFilters(baseFilters);
        cmd.outputOptions(outputOpts);
    }

    return new Promise((resolve, reject) => {
        cmd
            .output(outputPath)
            .on("start", () => logger.info("VideoGenerator", "FFmpeg encoding started"))
            .on("progress", (p) => logger.info("VideoGenerator", `Progress: ${Math.round(p.percent || 0)}%`))
            .on("end", () => {
                cleanup();
                logger.info("VideoGenerator", `Video saved: ${outputPath}`);
                resolve(outputPath);
            })
            .on("error", (err) => {
                cleanup();
                logger.error("VideoGenerator", "FFmpeg error", err);
                reject(new Error(`Video generation failed: ${err.message}`));
            })
            .run();
    });
}

/**
 * Quick validation - runs 2s FFmpeg test with given images. Call BEFORE ElevenLabs.
 * Throws if FFmpeg fails. No ElevenLabs credits spent.
 */
async function validatePipeline(imagePaths) {
    const { execSync } = require("child_process");
    const durationPerImage = 2 / imagePaths.length;
    const lines = [];
    for (const p of imagePaths) {
        lines.push(`file '${p}'`);
        lines.push(`duration ${durationPerImage}`);
    }
    lines.push(`file '${imagePaths[imagePaths.length - 1]}'`);
    const ts = Date.now();
    const concatPath = path.join(OUTPUT_DIR, `validate_${ts}.txt`);
    const outPath = path.join(OUTPUT_DIR, `validate_${ts}.mp4`);
    fs.writeFileSync(concatPath, lines.join("\n"));
    try {
        execSync(
            `ffmpeg -f concat -safe 0 -i "${concatPath}" -f lavfi -i anullsrc=r=44100:cl=stereo -t 2 ` +
                `-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-ow)/2:(ih-oh)/2,setsar=1,fps=25" ` +
                `-s 1080x1920 -aspect 9:16 -c:v libx264 -preset ultrafast -c:a aac -shortest -y "${outPath}"`,
            { stdio: "pipe" }
        );
    } catch (err) {
        throw new Error(
            "FFmpeg validation failed. Fix video pipeline before using ElevenLabs. Run: npm run test:ffmpeg"
        );
    } finally {
        try {
            fs.unlinkSync(concatPath);
            if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        } catch (_) {}
    }
}

module.exports = { generateVideo, hasDrawTextFilter, validatePipeline };
