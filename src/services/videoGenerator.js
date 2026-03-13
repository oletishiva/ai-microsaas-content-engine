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
const { buildConcatFile, getAudioDuration } = require("../../utils/ffmpegHelper");
const { VIDEO_DURATION } = require("../../utils/subtitleHelper");
const { renderTextToImage } = require("../../utils/textToImage");
const logger = require("../../utils/logger");

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
 * Run FFmpeg with image overlays using raw exec.
 * Uses time-based enable: hook 0-3s, quote 3s-end. No concat, no loop bugs.
 */
function runFfmpegWithOverlays(concatPath, audioPath, overlayPaths, baseFilters, outputPath, outputOpts, cleanup, videoDuration, W = 1080, H = 1920) {
    const { spawnSync } = require("child_process");

    const HOOK_DURATION = 2.2;
    const HOOK_FRAMES = Math.floor(HOOK_DURATION * 25); // 55 at 25fps – use n not t (fps filter breaks concat)
    const hook = overlayPaths.find((o) => o.start === 0 && o.end === HOOK_DURATION);
    const quote = overlayPaths.find((o) => o.start === HOOK_DURATION);

    const baseFilterStr = baseFilters.join(",");
    const hookY = `H*0.15`;
    const quoteY = `H*0.35`;
    const filterParts = [`[0:v]${baseFilterStr}[main]`];
    const loopInputs = [];

    const scaleOpt = `scale=${W}:-1`;
    const overlayPrep = `${scaleOpt},format=rgba`;
    if (hook && quote) {
        filterParts.push(`[1:v]${overlayPrep}[hook]`);
        filterParts.push(`[2:v]${overlayPrep}[quote]`);
        filterParts.push(`[main][hook]overlay=x=(W-w)/2:y=${hookY}:enable='lt(n,${HOOK_FRAMES})'[tmp]`);
        filterParts.push(`[tmp][quote]overlay=x=(W-w)/2:y=${quoteY}:enable='gte(n,${HOOK_FRAMES})'[out]`);
        loopInputs.push("-loop", "1", "-i", hook.path, "-loop", "1", "-i", quote.path);
    } else if (hook) {
        filterParts.push(`[1:v]${overlayPrep}[hook]`);
        filterParts.push(`[main][hook]overlay=x=(W-w)/2:y=${hookY}:enable='lt(n,${HOOK_FRAMES})'[out]`);
        loopInputs.push("-loop", "1", "-i", hook.path);
    } else if (quote) {
        filterParts.push(`[1:v]${overlayPrep}[quote]`);
        filterParts.push(`[main][quote]overlay=x=(W-w)/2:y=${quoteY}:enable='1'[out]`);
        loopInputs.push("-loop", "1", "-i", quote.path);
    }

    const filterComplex = filterParts.join(";");
    const audioIdx = 1 + loopInputs.length / 4;

    const args = [
        "-y",
        "-f", "concat", "-safe", "0", "-i", concatPath,
        ...loopInputs,
        "-i", audioPath,
        "-filter_complex", filterComplex,
        "-map", "[out]", "-map", `${audioIdx}:a`,
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

    const videoDuration = await getAudioDuration(audioPath).catch(() => VIDEO_DURATION);
    const durationPerImage = videoDuration / imagePaths.length;

    logger.info("VideoGenerator", `Rendering ${videoDuration.toFixed(1)}s video with ${imagePaths.length} images (${durationPerImage.toFixed(1)}s per slide)...`);

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
    cleanup.tempFiles = tempFiles;
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
    // fps=25 needed for n-based overlay. Avoid setpts – it can break concat (only first image).
    let baseFilters = [
        `scale=${W}:${H}:force_original_aspect_ratio=increase`,
        `crop=${W}:${H}:(iw-ow)/2:(ih-oh)/2`,
        ...(isRailway ? [] : [`zoompan=z='min(zoom+0.0012,1.08)':d=1:s=${W}x${H}:fps=25`]),
        "setsar=1",
        "fps=25",
    ];

    const HOOK_DURATION = 2.2;
    const HOOK_FRAMES_DT = Math.floor(HOOK_DURATION * 25);
    if (useDrawText) {
        if (hookText) {
            const hookFile = writeTextFile(OUTPUT_DIR, "hook", hookText);
            tempFiles.push(hookFile);
            baseFilters.push(buildDrawTextFilter(hookFile, 70, "h*0.15", `lt(n,${HOOK_FRAMES_DT})`));
        }
        if (script) {
            const scriptFile = writeTextFile(OUTPUT_DIR, "quote", script);
            tempFiles.push(scriptFile);
            baseFilters.push(buildDrawTextFilter(scriptFile, 44, "h*0.35", `gte(n,${HOOK_FRAMES_DT})`));
        }
    }

    const outputOpts = [
        "-t", String(videoDuration),
        "-r", "25",
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
        // First 3s: hook. Then: quote (script). Both in 20%-70% band.
        if (hookText) {
            const hookPath = path.join(OUTPUT_DIR, `overlay_hook_${ts}.png`);
            await renderTextToImage(hookText, hookPath, { fontSize: 70, videoWidth: W });
            overlayPaths.push({ path: hookPath, start: 0, end: HOOK_DURATION });
            tempFiles.push(hookPath);
        }
        if (script) {
            const quotePath = path.join(OUTPUT_DIR, `overlay_quote_${ts}.png`);
            await renderTextToImage(script, quotePath, { fontSize: 44, videoWidth: W });
            overlayPaths.push({ path: quotePath, start: HOOK_DURATION, end: videoDuration });
            tempFiles.push(quotePath);
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
                videoDuration,
                W,
                H,
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
