/**
 * src/routes/generateVideo.js
 * -----------------------------
 * POST /api/generate-video – 15-second marketing video pipeline
 * Optimized for Shorts, Reels, TikTok.
 */

const express = require("express");
const router = express.Router();
const logger = require("../../utils/logger");

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { generateScript } = require("../services/scriptGenerator");
const { generateVoice } = require("../services/voiceGenerator");
const { fetchImages } = require("../services/imageFetcher");
const { fetchBackgroundMusic } = require("../services/musicFetcher");
const { mixVoiceWithMusic } = require("../../utils/audioMixer");
const { generateVideo, validatePipeline } = require("../services/videoGenerator");
const { uploadToYouTube } = require("../services/youtubeUploader");
const { uploadVideoToCloudinary } = require("../services/cloudinaryUploader");
const { generateThumbnailWithHook } = require("../../utils/thumbnailGenerator");
const { OUTPUT_DIR } = require("../../config/paths");
const { VIDEO_DURATION } = require("../../utils/subtitleHelper");

const multer = require("multer");
const sharp = require("sharp");
const upload = multer({ dest: path.join(__dirname, "../../../output/uploads") });

/** Pre-resize uploaded images for Railway – reduces FFmpeg encode time (large uploads → target size) */
async function preResizeForRailway(filePaths, targetW, targetH) {
    const ts = Date.now();
    const resized = [];
    for (let i = 0; i < filePaths.length; i++) {
        const out = path.join(OUTPUT_DIR, `resized_${ts}_${i}.jpg`);
        await sharp(filePaths[i])
            .resize(targetW, targetH, { fit: "cover", position: "center" })
            .jpeg({ quality: 85 })
            .toFile(out);
        resized.push(out);
    }
    return resized;
}

/**
 * Derive hook from script (first sentence or first 5 words)
 */
function deriveHookFromScript(script) {
    const s = String(script || "").trim();
    if (!s) return "STOP SCROLLING";
    const firstSentence = s.split(/[.!?]/)[0]?.trim() || s;
    // Keep hook short for overlay (max 3 words, ~18 chars) to avoid cropping
    const hook = firstSentence.length > 20
        ? firstSentence.split(/\s+/).slice(0, 3).join(" ") + "..."
        : firstSentence;
    return hook.toUpperCase();
}

/**
 * POST /api/generate-video
 * Body (multipart/form-data):
 *   topic, script, imageQuery, maxWords, title, tags, addMusic, musicQuery, hook, imageCount, showQuote
 *   textColor (string)  - "white" (default) or "black"
 *   images (files)      - Up to 10 local image files (overrides Pexels)
 */
router.post("/generate-video", upload.array("images", 10), async (req, res) => {
    const {
        topic,
        script: scriptInput,
        hook: hookInput,
        imageQuery: imageQueryInput,
        imageCount: imageCountInput,
        showQuote: showQuoteInput,
        maxWords: maxWordsInput,
        title: titleInput,
        tags: tagsInput,
        addMusic: addMusicInput,
        musicQuery: musicQueryInput,
        addSubscribeButton: addSubscribeButtonInput,
        textColor: textColorInput,
        pushToYouTube: pushToYouTubeInput,
        youtubeTitle: youtubeTitleInput,
        youtubeTags: youtubeTagsInput,
        audioMode: audioModeInput,
    } = req.body;

    const topicTrimmed = typeof topic === "string" ? topic.trim() : "";
    const scriptTrimmed = typeof scriptInput === "string" ? scriptInput.trim() : "";
    const hookTrimmed = typeof hookInput === "string" ? hookInput.trim() : null;
    const imageQueryTrimmed = typeof imageQueryInput === "string" ? imageQueryInput.trim() : "";
    const maxWords = maxWordsInput === "50" || maxWordsInput === 50 ? 50 : 35;
    const customTitle = typeof titleInput === "string" ? titleInput.trim() : null;
    const customTags = Array.isArray(tagsInput) ? tagsInput : null;
    const addMusic = addMusicInput !== false && addMusicInput !== "false";
    const musicQuery = typeof musicQueryInput === "string" ? musicQueryInput.trim() : null;
    const addSubscribeButton = addSubscribeButtonInput === false || addSubscribeButtonInput === "false" ? false : true;
    const textColor = textColorInput === "black" ? "black" : "white";
    const pushToYouTube = pushToYouTubeInput === true || pushToYouTubeInput === "true";
    const customYouTubeTitle = typeof youtubeTitleInput === "string" ? youtubeTitleInput.trim() : null;
    const customYouTubeTags = typeof youtubeTagsInput === "string" ? youtubeTagsInput.split(',').map(t => t.trim()).filter(Boolean) : null;
    const audioMode = ["full", "voice-only", "silent"].includes(audioModeInput) ? audioModeInput : "full";
    
    const imageCountReq = (() => {
        const n = typeof imageCountInput === "number" ? imageCountInput : parseInt(imageCountInput, 10);
        return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
    })();
    const showQuoteReq = showQuoteInput === false || showQuoteInput === "false" ? false
        : showQuoteInput === true || showQuoteInput === "true" ? true
        : null;

    if (!topicTrimmed && !scriptTrimmed) {
        return res.status(400).json({
            success: false,
            error: 'Request body must include a non-empty "topic" or "script" string.',
        });
    }

    const apiKeys = require("../../config/apiKeys");
    const e2eTestMode = apiKeys.E2E_TEST_MODE;

    if (e2eTestMode) {
        logger.info("Pipeline", "E2E test mode: 15 words, 4 images (saves ElevenLabs + Pexels)");
    }

    const searchQuery = topicTrimmed || scriptTrimmed.split(/\s+/).slice(0, 5).join(" ");
    const pexelsQuery = imageQueryTrimmed || searchQuery;
    logger.info("Pipeline", `Starting (topic: "${topicTrimmed || "(none)"}", script: ${scriptTrimmed ? "provided" : "will generate"}, imageQuery: "${pexelsQuery}")`);

    let script, hook, quote = null, highlight = [], titleSuggest = null;
    let silentAudioPath = null;
    let imagePaths = [];
    
    try {
        // STEP 1: Get script (generate or use provided)
        if (scriptTrimmed) {
            logger.info("Pipeline", "STEP 1/6 – Using provided script...");
            script = scriptTrimmed;
            hook = hookTrimmed || deriveHookFromScript(script);
        } else {
            logger.info("Pipeline", `STEP 1/6 – Generating script (maxWords: ${maxWords})...`);
            const generated = await generateScript(topicTrimmed, e2eTestMode, { maxWords });
            script = generated.script;
            hook = hookTrimmed || generated.hook;
            quote = generated.quote || null;
            highlight = generated.highlight || [];
            titleSuggest = generated.title || null;
        }

        // STEP 2: Images (Local Uploads OR Pexels)
        const isRailway = !!process.env.RAILWAY_PROJECT_ID;
        if (req.files && req.files.length > 0) {
            logger.info("Pipeline", `STEP 2/6 – Using ${req.files.length} locally uploaded images...`);
            const rawPaths = req.files.map((file) => file.path);
            if (isRailway) {
                logger.info("Pipeline", "Pre-resizing uploads for Railway (faster FFmpeg)...");
                imagePaths = await preResizeForRailway(rawPaths, 720, 1280);
            } else {
                imagePaths = rawPaths;
            }
        } else {
            logger.info("Pipeline", "STEP 2/6 – Fetching images from Pexels...");
            const defaultCount = apiKeys.IMAGE_COUNT ?? (e2eTestMode ? 4 : isRailway ? 4 : 8);
            const imageCount = Math.max(1, Math.min(10, imageCountReq ?? defaultCount));
            imagePaths = await fetchImages(pexelsQuery, imageCount);
            logger.info("Pipeline", `Fetched ${imagePaths.length} images for video (target: ${imageCount})`);
        }

        // STEP 3: Validate FFmpeg pipeline BEFORE using ElevenLabs
        logger.info("Pipeline", "STEP 3/6 – Validating FFmpeg pipeline...");
        await validatePipeline(imagePaths);

        // STEP 4: Generate voice or silent audio (only after FFmpeg validation passes)
        let audioPath;
        if (audioMode === "silent" || apiKeys.E2E_SKIP_VOICE) {
            logger.info("Pipeline", `STEP 4/6 – Skipping voice (mode: ${audioMode}, test: ${apiKeys.E2E_SKIP_VOICE}), using silent audio...`);
            silentAudioPath = path.join(OUTPUT_DIR, `silent_${Date.now()}.mp3`);
            execSync(
                `ffmpeg -f lavfi -i anullsrc=r=44100:cl=stereo -t ${VIDEO_DURATION} -q:a 9 -acodec libmp3lame -y "${silentAudioPath}"`,
                { stdio: "pipe" }
            );
            audioPath = silentAudioPath;
        } else {
            logger.info("Pipeline", "STEP 4/6 – Generating voice...");
            audioPath = await generateVoice(script);
        }

        // STEP 4b: Add background music (optional). 
        let musicPath = null;
        if (addMusic && apiKeys.ADD_MUSIC && audioMode === "full") {
            musicPath = fetchBackgroundMusic();
            if (musicPath) {
                const mixedPath = path.join(OUTPUT_DIR, `mixed_${Date.now()}.mp3`);
                await mixVoiceWithMusic(audioPath, musicPath, mixedPath, {
                    musicOnly: (apiKeys.E2E_SKIP_VOICE || audioMode === "silent"),
                });
                audioPath = mixedPath;
            }
        }

        // STEP 5: Render video
        const timestamp = Date.now();
        const outputFilename = `video_${timestamp}.mp4`;
        const enableQuote = showQuoteReq !== null ? showQuoteReq : apiKeys.ENABLE_QUOTE_OVERLAY;
        let scriptForOverlay = null;
        if (enableQuote) {
            const overlayText = quote || script;
            const words = overlayText.split(/\s+/);
            scriptForOverlay = words.length > 45 ? words.slice(0, 45).join(" ") : overlayText;
        }
        if (!enableQuote) {
            logger.info("Pipeline", "Quote overlay disabled – images only");
        }
        logger.info("Pipeline", "STEP 5/6 – Rendering video...");
        const videoPath = await generateVideo(imagePaths, audioPath, scriptForOverlay, hook, outputFilename, {
            highlight,
            addSubscribeButton,
            textColor,
        });
        logger.info("Pipeline", "Video generated", { videoPath });

        // STEP 6: Upload to YouTube (optional – env token or session token from Connect YouTube + Push Toggle)
        const TOKEN_FILE = path.join(__dirname, "../../../output/.youtube_user_token");
        const fileToken = (() => { try { return fs.readFileSync(TOKEN_FILE, "utf8").trim() || null; } catch (_) { return null; } })();
        const sessionToken = req.session?.youtubeRefreshToken || fileToken;
        const canUploadToYouTube = pushToYouTube && (apiKeys.hasYouTubeConfig || (apiKeys.hasYouTubeOAuthConfig && sessionToken));
        let youtubeUrl = null;
        if (canUploadToYouTube) {
            logger.info("Pipeline", "STEP 6/6 – Uploading to YouTube (public, viral tags)...");
            try {
                // Derive a punchy title – cascade: AI suggest → hook → quote → script → topic
                const rawSource = titleSuggest
                    || (hook ? hook.replace(/\.\.\.$/,"").trim() : null)
                    || (quote ? quote.split(/[.!?]/).filter(Boolean)[0]?.trim() : null)
                    || (script ? script.split(/[.!?]/).filter(Boolean)[0]?.trim() : null)
                    || searchQuery
                    || "Motivation";
                // Keep to 8 words max and strip trailing ellipsis/punctuation
                const punchyTitle = rawSource.split(/\s+/).slice(0, 8).join(" ").replace(/[.!?,]+$/, "").trim() || "Motivation";
                // Append #shorts #motivation — YouTube highlights hashtags in title for Shorts discovery
                const titleBase = customYouTubeTitle || customTitle || punchyTitle;
                const ytTitle = `${titleBase} #shorts #motivation`;
                // Description: hashtags FIRST so they appear as subtitle in YouTube search results
                const ytDesc = [
                    `#motivation #quotes #shorts #motivationalquotes #quoteoftheday`,
                    "",
                    quote || script || punchyTitle,
                    "",
                    "Follow for daily wisdom 🔔",
                    "",
                    `#dailymotivation #selfimprovement #success #mindset #growthmindset #positivevibes #foryou #viral #deepquotes #lifelessons`,
                ].join("\n");
                let thumbnailPath = null;
                if (imagePaths.length > 0 && hook) {
                    thumbnailPath = path.join(OUTPUT_DIR, `thumb_${timestamp}.jpg`);
                    await generateThumbnailWithHook(imagePaths[0], hook, thumbnailPath);
                }
                youtubeUrl = await uploadToYouTube(videoPath, ytTitle, ytDesc, {
                    topic: searchQuery,
                    tags: customYouTubeTags || customTags,
                    privacyStatus: "public",
                    thumbnailPath,
                    refreshToken: sessionToken || undefined,
                });
                if (thumbnailPath && fs.existsSync(thumbnailPath)) {
                    try { fs.unlinkSync(thumbnailPath); } catch (_) {}
                }
                logger.info("Pipeline", `YouTube URL: ${youtubeUrl}`);
            } catch (uploadErr) {
                logger.warn("Pipeline", "YouTube upload failed (video still saved):", uploadErr.message);
            }
        } else {
            logger.info("Pipeline", "STEP 6/6 – Skipping YouTube (pushToYouTube is false or credentials not configured)");
        }

        // Upload to Cloudinary and return public video URL
        let videoUrl = null;
        if (apiKeys.hasCloudinaryConfig) {
            logger.info("Pipeline", "Uploading to Cloudinary...");
            try {
                videoUrl = await uploadVideoToCloudinary(videoPath, `video_${timestamp}`);
                logger.info("Pipeline", "Upload completed. Public video URL returned.", { videoUrl });
                // Delete local file after successful upload to save disk space
                if (fs.existsSync(videoPath)) {
                    fs.unlinkSync(videoPath);
                    logger.info("Pipeline", "Local video file cleaned up");
                }
            } catch (uploadErr) {
                logger.warn("Pipeline", "Cloudinary upload failed (video still saved locally):", uploadErr.message);
            }
        }

        logger.info("Pipeline", "Complete!");

        const response = {
            success: true,
            topic: topicTrimmed || null,
            script,
            maxWords,
            imageQuery: imageQueryTrimmed || null,
            imageCount: imagePaths.length,
            showQuote: enableQuote,
            youtubeUrl,
        };
        if (videoUrl) {
            response.videoUrl = videoUrl;
        } else {
            response.videoPath = videoPath;
        }

        return res.status(200).json(response);
    } catch (err) {
        logger.error("Pipeline", "Pipeline failed", err);
        return res.status(500).json({
            success: false,
            error: err.message || "Pipeline failed",
        });
    } finally {
        if (typeof silentAudioPath === "string" && fs.existsSync(silentAudioPath)) {
            try {
                fs.unlinkSync(silentAudioPath);
            } catch (_) {}
        }
    }
});

module.exports = router;
