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
 * Body:
 *   topic (string)      - Marketing topic (required if no script)
 *   script (string)     - Pre-written script (optional, overrides topic)
 *   imageQuery (string) - Pexels search keywords for images
 *   maxWords (number)   - Script length: 35 (default) or 50 for longer ~20s video
 *   title (string)      - YouTube video title (default: topic + " #Shorts")
 *   tags (string[])     - YouTube tags (overrides auto viral tags)
 *   addMusic (boolean)  - Add background music from Pixabay (default: true if PIXABAY_API_KEY set)
 *   musicQuery (string) - Music theme override (e.g. "calm", "motivation")
 *   hook (string)       - Custom hook text for first 3.5s overlay (default: derived from script)
 *   imageCount (number) - Number of images (1–10, default 10). Pass in request to override.
 *   showQuote (boolean) - Override quote overlay. When false, no quote text (images only). Default from ENABLE_QUOTE_OVERLAY env.
 */
router.post("/generate-video", async (req, res) => {
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
    } = req.body;

    const topicTrimmed = typeof topic === "string" ? topic.trim() : "";
    const scriptTrimmed = typeof scriptInput === "string" ? scriptInput.trim() : "";
    const hookTrimmed = typeof hookInput === "string" ? hookInput.trim() : null;
    const imageQueryTrimmed = typeof imageQueryInput === "string" ? imageQueryInput.trim() : "";
    const maxWords = maxWordsInput === 50 ? 50 : 35;
    const customTitle = typeof titleInput === "string" ? titleInput.trim() : null;
    const customTags = Array.isArray(tagsInput) ? tagsInput : null;
    const addMusic = addMusicInput !== false && addMusicInput !== "false";
    const musicQuery = typeof musicQueryInput === "string" ? musicQueryInput.trim() : null;
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

    let script, hook;
    let silentAudioPath = null;
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
        }

        // STEP 2: Fetch images (use imageQuery for Pexels, or topic/script)
        logger.info("Pipeline", "STEP 2/6 – Fetching images...");
        const isRailway = !!process.env.RAILWAY_PROJECT_ID;
        const defaultCount = apiKeys.IMAGE_COUNT ?? (e2eTestMode ? 4 : isRailway ? 4 : 8);
        const imageCount = Math.max(1, Math.min(10, imageCountReq ?? defaultCount));
        const imagePaths = await fetchImages(pexelsQuery, imageCount);
        logger.info("Pipeline", `Fetched ${imagePaths.length} images for video (target: ${imageCount})`);

        // STEP 3: Validate FFmpeg pipeline BEFORE using ElevenLabs
        logger.info("Pipeline", "STEP 3/6 – Validating FFmpeg pipeline...");
        await validatePipeline(imagePaths);

        // STEP 4: Generate voice or silent audio (only after FFmpeg validation passes)
        let audioPath;
        if (apiKeys.E2E_SKIP_VOICE) {
            logger.info("Pipeline", "STEP 4/6 – Skipping voice (E2E_SKIP_VOICE), using silent audio...");
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

        // STEP 4b: Add background music (optional). When no voice (E2E_SKIP_VOICE), use music at full volume.
        let musicPath = null;
        if (addMusic && apiKeys.ADD_MUSIC) {
            musicPath = fetchBackgroundMusic();
            if (musicPath) {
                const mixedPath = path.join(OUTPUT_DIR, `mixed_${Date.now()}.mp3`);
                await mixVoiceWithMusic(audioPath, musicPath, mixedPath, {
                    musicOnly: apiKeys.E2E_SKIP_VOICE,
                });
                audioPath = mixedPath;
            }
        }

        // STEP 5: Render video
        const timestamp = Date.now();
        const outputFilename = `video_${timestamp}.mp4`;
        const enableQuote = showQuoteReq !== null ? showQuoteReq : apiKeys.ENABLE_QUOTE_OVERLAY;
        const scriptForOverlay = enableQuote ? script : null;
        if (!enableQuote) {
            logger.info("Pipeline", "Quote overlay disabled – images only");
        }
        logger.info("Pipeline", "STEP 5/6 – Rendering video...");
        const videoPath = await generateVideo(imagePaths, audioPath, scriptForOverlay, hook, outputFilename);
        logger.info("Pipeline", "Video generated", { videoPath });

        // STEP 6: Upload to YouTube (optional – env token or session token from Connect YouTube)
        const sessionToken = req.session?.youtubeRefreshToken;
        const canUploadToYouTube = apiKeys.hasYouTubeConfig || (apiKeys.hasYouTubeOAuthConfig && sessionToken);
        let youtubeUrl = null;
        if (canUploadToYouTube) {
            logger.info("Pipeline", "STEP 6/6 – Uploading to YouTube (public, viral tags)...");
            try {
                const ytTitle = customTitle || `${searchQuery} #Shorts`;
                const ytDesc = `#Shorts #viral #motivation\n\nScript:\n${script}`;
                let thumbnailPath = null;
                if (imagePaths.length > 0 && hook) {
                    thumbnailPath = path.join(OUTPUT_DIR, `thumb_${timestamp}.jpg`);
                    await generateThumbnailWithHook(imagePaths[0], hook, thumbnailPath);
                }
                youtubeUrl = await uploadToYouTube(videoPath, ytTitle, ytDesc, {
                    topic: searchQuery,
                    tags: customTags,
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
            logger.info("Pipeline", "STEP 6/6 – Skipping YouTube (credentials not configured)");
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
