# AI Content Engine — Project Context

## What This Is

A Node.js SaaS app that auto-generates and publishes Telugu YouTube Shorts across three channels:
1. **Motivational Quotes** — notebook-style handwritten text videos
2. **Mahabharat Shorts** — Telugu spiritual/wisdom videos from Mahabharat stories
3. **Telugu Sameta** — ancient Telugu proverbs (సామెతలు) with illustrated characters

**Live URL:** Deployed on Railway

---

## Architecture

### Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 20, Express 4 |
| Frontend | Vanilla HTML/CSS/JS (single `public/index.html`) — 3-tab dashboard |
| AI Script | Anthropic Claude (`claude-sonnet-4-6`) |
| Background Image | OpenAI DALL-E 3 |
| Voice/TTS | ElevenLabs (`eleven_multilingual_v2`) |
| Video Assembly | FFmpeg via fluent-ffmpeg + Sharp (image compositing) |
| CDN | Cloudinary (video + raw DALL-E image) |
| YouTube | Google Data API v3 (OAuth2) |
| Instagram/Facebook | Meta Graph API (Reels + Video) |
| Deployment | Railway (Docker) |

### Directory Layout

```
src/
  app.js                      — Express entry point, routes, middleware
  routes/
    generateVideo.js          — POST /api/generate-video (notebook motivation pipeline)
    mahabharat.js             — POST /api/generate-mahabharat + /api/generate-mahabharat-video
    sameta.js                 — POST /api/generate-sameta
    auth.js                   — YouTube + Meta OAuth2 routes
  services/
    mahabharatScheduler.js    — Cron: 10 AM + 6 PM IST auto-post to YouTube
    cloudinaryUploader.js     — Upload video, return public URL
    youtubeUploader.js        — Upload to YouTube channel
    metaPublisher.js          — Instagram Reels + Facebook Video upload
utils/
  logger.js                   — Structured logging
config/
  apiKeys.js                  — Central key loader + validation
  paths.js                    — Cross-platform output paths
  cloudinary.js               — Cloudinary SDK init
public/
  index.html                  — Full UI (3-tab dashboard: Motivation / Mahabharat / Sameta)
mahabharat_video_gen.js       — Mahabharat video pipeline (DALL-E + Sharp + FFmpeg + TTS)
sameta_video_gen.js           — Sameta video pipeline (DALL-E + Sharp + FFmpeg)
notebook_video_gen.js         — Motivation notebook video pipeline (DALL-E + Sharp + FFmpeg)
output/                       — Runtime-generated files (gitignored)
  .mb_ep_counter              — Mahabharat episode counter (persists across restarts)
  .sameta_used.json           — Last 500 sametas used (prevents repeats)
  .youtube_user_token         — Persisted YouTube OAuth token
```

### Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Serve 3-tab UI |
| GET | `/health` | Railway health check |
| POST | `/api/generate-video` | Motivation notebook video |
| POST | `/api/generate-mahabharat` | Generate Mahabharat script (Claude) |
| POST | `/api/generate-mahabharat-video` | Full Mahabharat video (script → video → Cloudinary → YouTube) |
| POST | `/api/generate-sameta` | Full Sameta video (random or custom → video → Cloudinary → YouTube/Instagram/Facebook) |
| POST | `/api/trigger-mahabharat-cron` | Manually fire the cron job (protected by ADMIN_SECRET) |
| GET | `/api/download` | Proxy download for iOS Save to Phone |
| GET | `/auth/youtube` | Redirect to Google OAuth |
| GET | `/auth/youtube/callback` | OAuth2 callback |
| GET | `/auth/youtube/status` | Check YouTube connection (add `?channel=mahabharat` for MB channel) |
| POST | `/auth/youtube/disconnect` | Disconnect YouTube |
| GET | `/auth/meta/status` | Check Meta (Instagram/Facebook) connection |
| POST | `/auth/meta/disconnect` | Disconnect Meta |

---

## ✅ What's Done

### Motivation Tab
- [x] Notebook-style video: DALL-E background (wooden desk / marble) + Sharp text compositing
- [x] Handwritten Caveat Bold font rendered via Sharp (font file path + Pango markup)
- [x] Claude generates inspirational quote scripts
- [x] 4-frame animated progressive text reveal
- [x] Cloudinary upload, YouTube upload (OAuth)
- [x] Download to phone button (iOS Safari → Camera Roll via `/api/download` proxy)

### Mahabharat Tab
- [x] Claude (`claude-sonnet-4-6`) generates full 30s Telugu scripts (hook/story/lesson/CTA)
- [x] DALL-E generates scene image (characters in bottom 65%, top 35% empty for text)
- [x] Sharp composites: scene + cream overlay + Telugu text + gradient fade
- [x] ElevenLabs TTS for Telugu narration
- [x] FFmpeg assembles final vertical 1080×1920 Short
- [x] Upload video to Cloudinary
- [x] Upload raw DALL-E image to Cloudinary (for Google Flow / Veo animation)
- [x] Optional YouTube upload (per-user OAuth or env token)
- [x] `imageForFlow()` UI widget — shows DALL-E source image + "Open Google Flow →" link
- [x] Download to phone button
- [x] Auto-scheduler: 10 AM + 6 PM IST cron job (`mahabharatScheduler.js`)
- [x] Manual cron trigger via `/api/trigger-mahabharat-cron`
- [x] Episode counter persists in `output/.mb_ep_counter`

### Sameta Tab
- [x] Claude picks random Telugu proverb from 12-category rotation
- [x] No-repeat system: tracks last 500 sametas in `output/.sameta_used.json`
- [x] DALL-E generates illustrated scene (characters in bottom 65% of canvas)
- [x] Sharp composites: scene + cream overlay (45% height) + Telugu sameta text + gradient fade
- [x] Character visibility fix: cream overlay reduced from 60% to 45% — characters now fully visible
- [x] Upload video to Cloudinary
- [x] Upload raw DALL-E image to Cloudinary
- [x] YouTube upload (per-user OAuth or env token)
- [x] Instagram Reels upload (Meta Graph API)
- [x] Facebook Video upload (Meta Graph API)
- [x] Download to phone button
- [x] `imageForFlow()` UI widget — DALL-E source image + Google Flow link

### Infrastructure
- [x] 3-tab dashboard UI (Motivation / Mahabharat / Sameta)
- [x] Tab persistence through OAuth redirects (sessionStorage)
- [x] Auth status panel: YouTube (Motivation), YouTube (Mahabharat), Meta (Instagram/Facebook)
- [x] Toast notification on OAuth return (`?youtube=connected`)
- [x] Railway deployment: Dockerfile + nixpacks.toml + railway.json
- [x] Docker image: Node 20 + FFmpeg + libatomic1

---

## 🔲 What's Pending / Known Issues

### High Priority
1. **ElevenLabs on Railway** — API calls time out from Railway's IP range
   - Workaround: `E2E_SKIP_VOICE=1` uses silent audio
   - Fix: Switch to OpenAI TTS (`tts-1`) or Google Cloud TTS

2. **Sameta auto-scheduler** — No cron job for Sameta (only Mahabharat has one)
   - Add `sametaScheduler.js` similar to `mahabharatScheduler.js`

3. **Session token persistence** — YouTube OAuth token is in-memory session
   - Wiped on Railway redeploy; user must reconnect
   - Fix: Persist token to `output/.youtube_user_token` (already partially done)

### Medium Priority
4. **Google Flow / Veo integration** — Currently just a link to flow.google
   - Could add direct API call if Google Flow API becomes available
   - Image URL is already uploaded to Cloudinary and shown in UI

5. **Async job queue** — Long FFmpeg runs can hit Railway timeout
   - Fix: BullMQ + Redis background jobs with polling

6. **Video history** — No record of past generations
   - Fix: Postgres on Railway or Supabase

### Low Priority
7. **More Mahabharat characters** — Only 20 in rotation; expand list
8. **Subtitle/Caption overlay** — Word-by-word animated captions
9. **TikTok upload** — Currently Instagram + Facebook + YouTube only
10. **Analytics dashboard** — YouTube video performance metrics

---

## Environment Variables Reference

```env
PORT=3000

ANTHROPIC_API_KEY=            # Claude script generation (all 3 pipelines)
OPENAI_API_KEY=               # DALL-E 3 image generation
ELEVENLABS_API_KEY=           # TTS (not working on Railway — use E2E_SKIP_VOICE=1)
ELEVENLABS_VOICE_ID=          # Default: Rachel voice

YOUTUBE_CLIENT_ID=            # Google OAuth2 credentials
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REFRESH_TOKEN=        # Shared Motivation channel token
YOUTUBE_REDIRECT_URI=

MAHABHARAT_YOUTUBE_REFRESH_TOKEN=   # Separate Mahabharat channel token
MAHABHARAT_AUTO_PUBLISH=true        # Enable 10AM+6PM IST auto-scheduler

META_APP_ID=                  # Facebook App ID
META_APP_SECRET=              # Facebook App Secret

CLOUDINARY_CLOUD_NAME=        # CDN for public video + image URLs
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

ADMIN_SECRET=                 # Protects /api/trigger-mahabharat-cron

E2E_TEST_MODE=0               # 1 = short videos (saves API credits)
E2E_SKIP_VOICE=1              # 1 = skip ElevenLabs (Railway workaround)
MOTIVATIONAL_CHANNEL_NAME=    # Channel name shown in motivation videos
```

---

## Video Specs

- Format: 1080×1920 (9:16 vertical), H.264 MP4
- Duration: ~30 seconds (Mahabharat/Sameta), ~15 seconds (Motivation)
- Frame rate: 25fps
- Mahabharat/Sameta layout: top 35% cream text area + bottom 65% DALL-E scene

---

## Deployment Notes

- **Railway** uses `Dockerfile` (defined in `railway.json`)
- FFmpeg installed via Dockerfile; nixpacks.toml is a fallback
- Health check: `GET /health` → `{"status":"ok"}`
- Output dir `/output/` is created at startup; wiped on redeploy
- Always set `E2E_SKIP_VOICE=1` on Railway until ElevenLabs is fixed
- Cloudinary free plan: 25GB storage / 25GB bandwidth — enough for ~500-1000 videos
- Railway $5/month plan: handles ~10 concurrent users; upgrade to $20 for scale
