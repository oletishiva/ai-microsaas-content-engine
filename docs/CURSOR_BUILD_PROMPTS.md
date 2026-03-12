# Cursor Build Prompts – AI Content Engine (E2E Micro SaaS Demo)

Use these prompts **step-by-step** with Cursor when building this project from scratch. Each prompt is self-contained and can be pasted into a new Cursor chat.

---

## Step 1: Project Setup & Core Structure

```
Create a Node.js project for an AI Content Engine – a micro SaaS that generates short marketing videos from a topic.

Pipeline: OpenAI (script) → ElevenLabs (voice) → Pexels (images) → FFmpeg (video) → YouTube (upload).

Set up:
- Express server with POST /api/generate-video
- config/apiKeys.js to load API keys from .env
- src/services/ for scriptGenerator, voiceGenerator, imageFetcher, videoGenerator, youtubeUploader
- utils/ffmpegHelper.js for concat file building and audio probe
- Central logger in utils/logger.js
- Output videos to /output/ folder
```

---

## Step 2: API Key Validation & Error Handling

```
In config/apiKeys.js:
- Validate all required API keys at startup (OPENAI, ELEVENLABS, PEXELS)
- Export hasYouTubeConfig for optional YouTube upload
- Load from process.env with clear error messages if missing

In src/routes/generateVideo.js:
- Fix any import path issues (e.g. ../config/apiKeys vs ../../config/apiKeys)
- Add proper error handling and try/catch
- Return 400 for invalid topic, 500 with error message on failure
```

---

## Step 3: Script Generator (OpenAI)

```
In scriptGenerator.js:
- Use OpenAI to generate a marketing script from a topic
- Max 35 words, ~200 chars – optimized for 15-second videos
- Structure: Hook → Problem → Solution → CTA
- Return { script, hook } where hook is the first sentence or first 5 words for overlay
- Support E2E_TEST_MODE: when env E2E_TEST_MODE=1, limit to 15 words for testing
```

---

## Step 4: Video Format & Output

```
In videoGenerator.js:
- Fixed 15-second duration, vertical 1080×1920 (9:16)
- Output filename: video_<timestamp>.mp4 (not finalVideo.mp4)
- Spread images evenly across 15 seconds
- Scale images with force_original_aspect_ratio=decrease, pad to 1080×1920 with black bars
- Use concat demuxer for image slideshow
```

---

## Step 5: YouTube OAuth2 Setup

```
Create scripts/get-youtube-refresh-token.js:
- OAuth2 flow for YouTube Data API
- Use port 3456 for callback to avoid conflict with main app
- Print refresh token after user authorizes

Create scripts/test-youtube-upload.js:
- Test upload without running full pipeline (saves API credits)

Create scripts/verify-youtube-token.js:
- Check if refresh token is valid

In .env: YOUTUBE_REDIRECT_URI=http://localhost:3456/oauth2callback

In youtubeUploader.js: Make upload optional when credentials are missing (don't fail the pipeline)
```

---

## Step 6: E2E Test Mode

```
Add E2E_TEST_MODE to config/apiKeys.js from env.

When E2E_TEST_MODE=1:
- Script: 15 words max
- Images: 2 instead of 5
- Saves ElevenLabs and Pexels usage for quick testing
```

---

## Step 7: FFmpeg Validation Before ElevenLabs

```
In videoGenerator.js add validatePipeline(imagePaths):
- Run a 2-second FFmpeg test with given images before any paid API calls
- Throws if FFmpeg fails – so we don't spend ElevenLabs credits on a broken pipeline

In generateVideo route: Call validatePipeline AFTER fetching images, BEFORE generateVoice
```

---

## Step 8: Subtitle Segments

```
Create utils/subtitleHelper.js:
- getSubtitleSegments(script) – split script into 3–4 key phrases
- Return [{ text, start, end }] with even time slots across 15 seconds
- Used for timed text overlay display
```

---

## Step 9: Text Overlays (Drawtext Path)

```
In videoGenerator.js:
- If FFmpeg has drawtext filter (check via ffmpeg -filters):
  - Use drawtext with textfile option for hook (0–2s) and subtitle segments
  - Hook at y=h*0.75, subtitles at y=h*0.85
  - Use enable='between(t,start,end)' for timing
- If no drawtext: skip overlays and log a warning (we'll add image overlay next)
```

---

## Step 10: Text Overlays (Image Overlay Fallback)

```
FFmpeg's drawtext requires libfreetype. When it's not available, use image overlay:

1. Create utils/textToImage.js:
   - Use Sharp + SVG to render text to PNG
   - White text, black stroke, semi-transparent black background bar
   - Returns path to saved PNG

2. In videoGenerator.js when drawtext is missing:
   - Render hook and each subtitle segment to PNG via renderTextToImage
   - Add each PNG as FFmpeg input with -loop 1
   - Use overlay filter with enable='between(t\,start\,end)' – ESCAPE COMMAS in the expression
   - Use spawnSync with raw FFmpeg (not fluent-ffmpeg) for reliability
   - outputOpts must use separate args: ["-t", "15", "-c:v", "libx264", ...] not ["-t 15"]
```

---

## Step 11: Overlay Debug Script

```
Create scripts/test-overlay-debug.js:
- Renders "TEST HOOK TEXT" to PNG
- Uses existing concat.txt and media images
- Runs raw FFmpeg overlay (no enable) for 15 seconds
- Output: output/debug_overlay_test.mp4
- Run with: node scripts/test-overlay-debug.js
- Use to verify overlay pipeline works before full run
```

---

## Step 12: Railway Deployment

```
For Railway deployment:
- Procfile: web: npm start
- PORT from process.env.PORT (Railway sets automatically)
- nixpacks.toml: [phases.setup] nixPkgs = ["ffmpeg"]
- config/paths.js: Use process.cwd() for OUTPUT_DIR, MEDIA_DIR (cross-platform)
- Create output + output/media on startup (app.js)
- GET /health returns { status: "ok" } for load balancers
- Env vars in Railway: OPENAI_API_KEY, ELEVENLABS_API_KEY, PEXELS_API_KEY (required); YOUTUBE_* (optional)
- YouTube redirect: https://your-app.railway.app/oauth2callback
```

---

## Quick Reference: Key Files

| File | Purpose |
|------|---------|
| `config/apiKeys.js` | Load & validate API keys, E2E_TEST_MODE |
| `config/paths.js` | OUTPUT_DIR, MEDIA_DIR (process.cwd-based) |
| `src/services/scriptGenerator.js` | OpenAI script, 35 words, Hook/Problem/Solution/CTA |
| `src/services/voiceGenerator.js` | ElevenLabs TTS |
| `src/services/imageFetcher.js` | Pexels images to output/media/ |
| `src/services/videoGenerator.js` | FFmpeg 15s 1080×1920, overlays, validatePipeline |
| `src/services/youtubeUploader.js` | OAuth2 upload, optional when no creds |
| `utils/subtitleHelper.js` | getSubtitleSegments for timed overlays |
| `utils/textToImage.js` | Sharp+SVG text to PNG (overlay fallback) |
| `utils/ffmpegHelper.js` | buildConcatFile, getAudioDuration |

---

## Common Gotchas

1. **Overlay enable expression**: Use `between(t\,0\,2)` not `between(t,0,2)` – commas must be escaped.
2. **spawnSync args**: Pass `["-t", "15"]` not `["-t 15"]` – each option and value as separate array elements.
3. **Fluent-ffmpeg vs raw FFmpeg**: For complex overlay graphs, raw `spawnSync("ffmpeg", args)` is more reliable.
4. **YouTube OAuth**: Redirect URI must match exactly in Google Console and .env.
5. **Restart server** after code changes – Node doesn't hot-reload.
