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
const { renderSubscribeButton } = require("../../utils/subscribeButton");
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
 * Run FFmpeg with image overlays.
 * Uses concat FILTER (not demuxer) – reliable multi-image on all platforms.
 */
/**
 * runFfmpegWithOverlays
 * ---------------------
 * @param {string[]} imagePaths
 * @param {number}   durationPerImage
 * @param {string}   audioPath
 * @param {Array}    overlayPaths     - [{path, start, end}, ...]
 * @param {*}        _baseFilters     - unused (kept for signature compat)
 * @param {string}   outputPath
 * @param {string[]} outputOpts
 * @param {Function} cleanup
 * @param {number}   videoDuration
 * @param {number}   [W=1080]         - video width
 * @param {number}   [H=1920]         - video height
 * @param {string|null} [subscribePath=null] - Subscribe button PNG path (full duration)
 */
function runFfmpegWithOverlays(imagePaths, durationPerImage, audioPath, overlayPaths, _baseFilters, outputPath, outputOpts, cleanup, videoDuration, W = 1080, H = 1920, subscribePath = null) {
    const { spawnSync } = require("child_process");

    // 3.5s hook: YouTube Shorts auto-generate thumbnails from video frames (no custom thumb API).
    // Longer hook = more frames with hook = higher chance YouTube picks hook for thumbnail.
    const HOOK_DURATION = 3.5;
    const hook = overlayPaths.find((o) => o.start === 0 && o.end === HOOK_DURATION);
    const quote = overlayPaths.find((o) => o.start === HOOK_DURATION);
    const n = imagePaths.length;

    // Scale each image to WxH before concat (concat requires identical input dimensions)
    const scaleCrop = (i) => `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-ow)/2:(ih-oh)/2,setsar=1[${i}s]`;
    const scaledInputs = imagePaths.map((_, i) => `[${i}s]`).join("");
    const hookIdx = n;
    const quoteIdx = n + 1;

    // How many overlay images come before the audio?
    const contentOverlayCount = (hook ? 1 : 0) + (quote ? 1 : 0);
    const subscribeIdx = n + contentOverlayCount;   // index of subscribe input (if used)
    const audioIdx    = subscribeIdx + (subscribePath ? 1 : 0);

    const baseChain = imagePaths.map((_, i) => scaleCrop(i)).join(";") + `;${scaledInputs}concat=n=${n}:v=1:a=0,fps=25[base]`;
    const overlayPrep = (idx) => `[${idx}:v]scale=${W}:-1,format=rgba`;

    let filter;
    const imageInputs = imagePaths.flatMap((p) => ["-loop", "1", "-t", String(durationPerImage.toFixed(2)), "-i", path.resolve(p)]);
    const overlayInputs = [];

    // ── Build hook / quote chained overlays ──────────────────────────────────
    if (hook && quote) {
        filter = `${baseChain};${overlayPrep(hookIdx)}[hook];${overlayPrep(quoteIdx)}[quote];[base][hook]overlay=x=(W-w)/2:y=H*0.15:enable='between(t,0,${HOOK_DURATION})'[tmp];[tmp][quote]overlay=x=(W-w)/2:y=H*0.15:enable='gte(t,${HOOK_DURATION})'[preout]`;
        overlayInputs.push("-loop", "1", "-i", hook.path, "-loop", "1", "-i", quote.path);
    } else if (hook) {
        filter = `${baseChain};${overlayPrep(hookIdx)}[hook];[base][hook]overlay=x=(W-w)/2:y=H*0.15:enable='between(t,0,${HOOK_DURATION})'[preout]`;
        overlayInputs.push("-loop", "1", "-i", hook.path);
    } else if (quote) {
        filter = `${baseChain};${overlayPrep(hookIdx)}[quote];[base][quote]overlay=x=(W-w)/2:y=H*0.15:enable='1'[preout]`;
        overlayInputs.push("-loop", "1", "-i", quote.path);
    } else {
        throw new Error("No overlay paths");
    }

    // ── Chain Subscribe button overlay (full-duration, 15% from bottom) ──────
    if (subscribePath) {
        // Scale the subscribe button to 60% of video width max; keep aspect ratio
        const subMaxW = Math.round(W * 0.60);
        filter += `;[${subscribeIdx}:v]scale=${subMaxW}:-1,format=rgba[sub];[preout][sub]overlay=x=(W-w)/2:y=H-h-H*0.07:enable='1'[out]`;
        overlayInputs.push("-loop", "1", "-i", subscribePath);
    } else {
        // Rename preout → out if no subscribe button
        filter = filter.replace("[preout]", "[out]");
    }

    const args = [
        "-y",
        ...imageInputs,
        ...overlayInputs,
        "-i", audioPath,
        "-filter_complex", filter,
        "-map", "[out]", "-map", `${audioIdx}:a`,
        ...outputOpts,
        outputPath,
    ];

    return new Promise((resolve, reject) => {
        try {
            logger.info("VideoGenerator", "FFmpeg encoding started (image overlays, alt pipeline)");
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
async function generateVideo(imagePaths, audioPath, script, hookText, outputFilename, overlayOptions = {}) {
    // overlayOptions.addSubscribeButton  – boolean, default true
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

    // Always use image overlay when we have hook/script: drawtext+zoompan path breaks
    // multi-image (only first image shows) and hook timing. Image overlay works everywhere.
    const useDrawText = hasDrawTextFilter() && !(hookText || script);
    const useImageOverlay = !useDrawText;
    if (useImageOverlay && (hookText || script)) {
        logger.info("VideoGenerator", "Using image overlay (hook+quote, multi-image safe).");
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

    // 3.5s hook: YouTube Shorts auto-generate thumbnails from video frames (no custom thumb API).
    const HOOK_DURATION = 3.5;
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
        "-threads", isRailway ? "2" : "1",
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
        // First 3s: hook. Then: quote. Readable font size.
        const hookFont = isRailway ? 80 : 72;
        const quoteFont = isRailway ? 45 : 46;  // Railway: 10% smaller (was 50) to avoid overflow
        if (hookText) {
            const hookPath = path.join(OUTPUT_DIR, `overlay_hook_${ts}.png`);
            await renderTextToImage(hookText, hookPath, { fontSize: hookFont, videoWidth: W, maxCharsPerLine: 11, textColor: overlayOptions.textColor });
            overlayPaths.push({ path: hookPath, start: 0, end: HOOK_DURATION });
            tempFiles.push(hookPath);
        }
        if (script) {
            const quotePath = path.join(OUTPUT_DIR, `overlay_quote_${ts}.png`);
            const highlight = overlayOptions.highlight || [];
            await renderTextToImage(script, quotePath, { fontSize: quoteFont, videoWidth: W, maxCharsPerLine: 24, highlight, textColor: overlayOptions.textColor });
            overlayPaths.push({ path: quotePath, start: HOOK_DURATION, end: videoDuration });
            tempFiles.push(quotePath);
        }

        // ── Subscribe button overlay ────────────────────────────────────────
        // Default ON; caller can disable via overlayOptions.addSubscribeButton = false
        const addSubscribeBtn = overlayOptions.addSubscribeButton !== false;
        let subscribePath = null;
        if (addSubscribeBtn) {
            subscribePath = path.join(OUTPUT_DIR, `overlay_subscribe_${ts}.png`);
            try {
                await renderSubscribeButton(subscribePath, { videoWidth: W });
                tempFiles.push(subscribePath);
                logger.info("VideoGenerator", "Subscribe button overlay rendered.");
            } catch (subErr) {
                logger.warn("VideoGenerator", "Subscribe button render failed (skipping):", subErr.message);
                subscribePath = null;
            }
        }

        if (overlayPaths.length > 0) {
            return runFfmpegWithOverlays(
                imagePaths,
                durationPerImage,
                audioPath,
                overlayPaths,
                baseFilters,
                outputPath,
                outputOpts,
                cleanup,
                videoDuration,
                W,
                H,
                subscribePath,
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
