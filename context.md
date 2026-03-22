# AI Content Engine — Project Context

## What This Is

A Node.js SaaS app that generates short-form vertical videos (YouTube Shorts) from a topic or script. The user enters a topic in the UI, the backend orchestrates AI services, FFmpeg assembles the video, and it optionally pushes to YouTube.

**Live flow:**
```
Topic → OpenAI (script) → ElevenLabs (voice) → Pexels (images) → FFmpeg (video) → Cloudinary (CDN) → YouTube (upload)
```

---

## Architecture

### Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 20, Express 4 |
| Frontend | Vanilla HTML/CSS/JS (single `public/index.html`) |
| AI Script | OpenAI GPT-4o-mini |
| Voice/TTS | ElevenLabs (`eleven_multilingual_v2`) |
| Images | Pexels API |
| Video Assembly | FFmpeg via fluent-ffmpeg |
| CDN | Cloudinary |
| YouTube | Google Data API v3 (OAuth2) |
| Deployment | Railway (Docker + nixpacks) |

### Directory Layout

```
src/
  app.js                  — Express entry point, routes, middleware
  routes/
    generateVideo.js      — POST /api/generate-video (main pipeline)
    auth.js               — YouTube OAuth2 routes
  services/
    scriptGenerator.js    — OpenAI script + hook + quote generation
    voiceGenerator.js     — ElevenLabs TTS → MP3
    imageFetcher.js       — Pexels image download + portrait crop
    musicFetcher.js       — Picks a track from /music/
    videoGenerator.js     — FFmpeg 1080×1920 assembly
    cloudinaryUploader.js — Upload video, return public URL
    youtubeUploader.js    — Upload to YouTube channel
utils/
  ffmpegHelper.js         — Concat/probe helpers
  audioMixer.js           — Voice + music mixing
  textToImage.js          — Renders text overlay images
  thumbnailGenerator.js   — Hook text image
  subscribeButton.js      — Subscribe button overlay
  logger.js               — Structured logging
config/
  apiKeys.js              — Central key loader + validation
  paths.js                — Cross-platform output paths
  cloudinary.js           — Cloudinary SDK init
public/
  index.html              — Full UI (837 lines, dark theme)
music/
  track1-3.mp3            — 3 bundled background tracks
output/                   — Runtime-generated files (gitignored)
scripts/                  — One-time setup / debug utilities
```

### Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Serve UI |
| GET | `/health` | Railway health check |
| POST | `/api/generate-video` | Main pipeline |
| GET | `/auth/youtube` | Redirect to Google OAuth |
| GET | `/auth/youtube/callback` | OAuth2 callback |
| GET | `/auth/youtube/status` | Check connection |
| POST | `/auth/youtube/disconnect` | Disconnect account |
| GET | `/test-openai` | Debug OpenAI key |

### Video Specs

- Format: 1080×1920 (9:16 vertical), H.264 MP4
- Duration: ~15 seconds
- Frame rate: 25fps
- Pipeline: images scaled/cropped → concat with fade → text overlays → audio mix

---

## What's Done

- [x] Full pipeline: topic → script → voice → images → FFmpeg → Cloudinary → YouTube
- [x] OpenAI script generation with hook, quote, title, tags (GPT-4o-mini, 3x retry for Railway)
- [x] ElevenLabs TTS (Rachel voice, MP3 44.1kHz 128kbps)
- [x] Pexels image fetching — portrait-first search, landscape fallback, auto-crop to 9:16
- [x] Local image uploads (up to 10, drag-drop in UI, multer)
- [x] Pre-resize images with Sharp before FFmpeg (faster on Railway)
- [x] FFmpeg concat with fade transitions, 2-thread limit for Railway
- [x] Text overlays: hook (first 3.5s), quote, subscribe button
- [x] Background music from bundled tracks (3 themes)
- [x] Audio modes: full (voice + music), voice-only, silent
- [x] Cloudinary upload after generation (public URL, local file deleted)
- [x] YouTube upload with OAuth2 — both shared env token and per-user session token
- [x] Multi-user session support (per-user YouTube token)
- [x] E2E test mode (`E2E_TEST_MODE=1`) — shorter scripts, saves API credits
- [x] Voice skip mode (`E2E_SKIP_VOICE=1`) — silent audio for Railway workaround
- [x] Railway deployment: Dockerfile + nixpacks.toml + railway.json
- [x] Docker image: Node 20 + FFmpeg + libatomic1
- [x] Responsive dark-theme UI with collapsible advanced settings
- [x] Pexels visual theme selector, text color toggle, quote/subscribe toggles
- [x] Debug endpoints for testing OpenAI and ElevenLabs keys

---

## Known Issues / Limitations

### ElevenLabs on Railway — SKIPPED
- ElevenLabs API calls time out or fail from Railway's IP range
- Workaround in place: `E2E_SKIP_VOICE=1` generates silent audio instead
- Videos on Railway are currently voice-free (music only or full silent)
- This is the biggest missing feature for production use

### No Persistent Storage
- Output files are written to `/output/` inside the Railway container
- Container restarts wipe all generated videos
- Cloudinary upload mitigates this — but only if Cloudinary is configured
- No database, no job queue, no history of past generations

### Single-Request Synchronous Pipeline
- The entire pipeline runs synchronously in one HTTP request
- No background jobs, no status polling
- Long FFmpeg runs can hit Railway's request timeout (~30-60s)
- No way to resume a failed generation

### No Auth / Rate Limiting
- The UI and API are completely open — anyone with the URL can generate videos
- No user accounts, no usage tracking, no API keys for consumers
- No rate limiting on `/api/generate-video`

### YouTube OAuth Session Only
- Per-user YouTube tokens live in Express session (in-memory)
- Session is lost on server restart — user has to reconnect
- Env-level `YOUTUBE_REFRESH_TOKEN` is a shared channel token (single channel)

---

## What Needs to Be Done

### High Priority

1. **ElevenLabs Fix or Alternative on Railway**
   - Investigate proxy or outbound IP allowlisting on Railway
   - Alternative: use OpenAI TTS (`tts-1` model) as drop-in replacement — no IP issues
   - Alternative: Google Cloud TTS (also reliable from Railway)

2. **Async Job Queue**
   - Move generation to a background job (Bull/BullMQ + Redis, or Railway background worker)
   - Return a job ID immediately, frontend polls `/api/jobs/:id/status`
   - Prevents Railway timeout on long FFmpeg runs

3. **Persistent Video History**
   - Store generation metadata in a database (Postgres on Railway or Supabase)
   - Keep Cloudinary URL, topic, script, YouTube URL, timestamp
   - Show past generations in the UI

4. **User Authentication**
   - Add basic auth (email + password or OAuth via Google)
   - Tie YouTube tokens and generation history to user accounts
   - Session storage should persist across restarts (Redis or DB)

### Medium Priority

5. **Rate Limiting**
   - Add express-rate-limit on `/api/generate-video`
   - Protect API keys from abuse

6. **Multiple Video Styles / Templates**
   - Different text overlay layouts (top/bottom quote, no hook, full-screen text)
   - Different aspect ratio exports (1:1 for Instagram, 16:9 for standard)

7. **Better Error UX**
   - Pipeline partial failures (e.g., Pexels fails) should show clearer error messages
   - Retry UI option without re-entering all settings

8. **More Music Tracks**
   - Currently 3 bundled tracks — add more variety or integrate a royalty-free API (e.g., Pixabay music)

### Low Priority / Nice to Have

9. **Subtitle/Caption Overlay**
   - Burn in word-by-word animated captions (requires word timestamps from ElevenLabs or Whisper)
   - High engagement feature for Shorts

10. **Scheduled Publishing**
    - Schedule YouTube uploads to specific times
    - Batch generate N videos and schedule them across a week

11. **TikTok / Instagram Upload**
    - Add TikTok API or Instagram Graph API upload alongside YouTube
    - Currently only YouTube is supported

12. **Analytics Dashboard**
    - Show YouTube video performance (views, likes) pulled from YouTube Data API
    - Simple metrics page per generated video

---

## Environment Variables Reference

```env
PORT=3000

OPENAI_API_KEY=           # GPT-4o-mini script generation
ELEVENLABS_API_KEY=       # TTS (not working on Railway — skipped)
ELEVENLABS_VOICE_ID=      # Default: Rachel voice

PEXELS_API_KEY=           # Stock image search

YOUTUBE_CLIENT_ID=        # Google OAuth2 credentials
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REFRESH_TOKEN=    # Shared channel token
YOUTUBE_REDIRECT_URI=

CLOUDINARY_CLOUD_NAME=    # CDN for public video URLs
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

E2E_TEST_MODE=0           # 1 = short videos (saves API credits)
E2E_SKIP_VOICE=1          # 1 = skip ElevenLabs (Railway workaround)
IMAGE_COUNT=4             # Default images per video
ENABLE_QUOTE_OVERLAY=     # Toggle quote text overlay

AUTO_PUBLISH=true         # Enable 6x daily auto-posting scheduler
SCHEDULE_TIMEZONE=UTC     # Timezone for schedule (e.g. Asia/Kolkata, America/New_York)
```

---

## Deployment Notes

- **Railway** uses `Dockerfile` (defined in `railway.json`)
- FFmpeg is installed via Dockerfile; nixpacks.toml is a fallback
- `RAILPACK_DEPLOY_APT_PACKAGES=ffmpeg libatomic1` must be set if using nixpacks build
- Health check: `GET /health` → `{"status":"ok"}`
- Output dir `/output/` is created at startup; wiped on redeploy
- Always set `E2E_SKIP_VOICE=1` on Railway until ElevenLabs is fixed
