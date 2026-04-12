# AI Content Engine — Project Context

## What This Is

A Node.js SaaS app that auto-generates and publishes Telugu + English short-form videos (YouTube Shorts, Instagram Reels, Facebook) across three service channels:

1. **Affirmations & Positive Vibes** — cinematic full-bleed DALL-E backgrounds + quote text overlay (English + Telugu, 5 types)
2. **Mahabharat Shorts** — 4-scene Telugu wisdom videos with Gemini/DALL-E images + progressive text reveal
3. **Telugu Sameta** — ancient Telugu proverbs (సామెతలు) with illustrated DALL-E characters

**Live URL:** Deployed on Railway (auto-deploys from `main` branch on GitHub)

---

## Architecture

### Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 20, Express 4 |
| Frontend | Vanilla HTML/CSS/JS — `public/index.html` (3-tab dashboard) + `public/mahabharat.html` |
| AI Script | Anthropic Claude (`claude-sonnet-4-6`) |
| Background Image | Gemini Imagen 3 (primary) / DALL-E 3 (fallback / Affirmations) |
| Video Assembly | FFmpeg + Sharp (image compositing + Pango text) |
| CDN | Cloudinary (video + raw image + composited image) |
| YouTube | Google Data API v3 (OAuth2 — **per-service tokens**) |
| Instagram/Facebook | Meta Graph API (Reels + Video) |
| Deployment | Railway (Docker) |

### Directory Layout

```
src/
  app.js                      — Express entry point, routes, middleware
  routes/
    generateVideo.js          — POST /api/generate-video (legacy notebook pipeline)
    affirmation.js            — POST /api/generate-affirmation
    mahabharat.js             — POST /api/generate-mahabharat + /api/generate-mahabharat-video
                                  /api/mahabharat-scene-prompts + /api/build-mahabharat-from-images
    sameta.js                 — POST /api/generate-sameta
    auth.js                   — YouTube OAuth2 (per-service tokens) + Meta OAuth2
    social.js                 — Meta OAuth + unified /api/publish
  services/
    mahabharatScheduler.js    — Cron: 10 AM + 6 PM IST auto-post to YouTube
    scheduler.js              — Motivation cron (3x/day, currently using notebook pipeline)
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
  index.html                  — Main UI (3-tab dashboard: Affirmations / Mahabharat / Sameta)
  mahabharat.html             — Mahabharat generator (full-featured, separate page)
affirmation_video_gen.js      — Affirmations pipeline (DALL-E + Sharp + FFmpeg)
mahabharat_video_gen.js       — Mahabharat pipeline (Gemini/DALL-E + Sharp + FFmpeg)
sameta_video_gen.js           — Sameta pipeline (DALL-E + Sharp + FFmpeg)
notebook_video_gen.js         — Legacy motivation notebook pipeline
fonts/
  Caveat-Bold.ttf             — English handwritten font (Affirmations)
  NotoSansTelugu.ttf          — Telugu font (Affirmations + Mahabharat + Sameta)
music/                        — Background music files (mp3/m4a/wav)
output/                       — Runtime-generated files (gitignored)
  .mb_ep_counter              — Mahabharat episode counter (persists across restarts)
  .sameta_used.json           — Last 500 sametas used (prevents repeats)
  .youtube_user_token         — Legacy default YouTube OAuth token
  .youtube_affirmation_token  — Affirmations channel token
  .youtube_sameta_token       — Sameta channel token
  .youtube_mahabharat_token   — Mahabharat channel token
  .meta_tokens.json           — Meta (Instagram/Facebook) tokens
```

### Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Serve 3-tab UI (index.html) |
| GET | `/mahabharat` | Serve Mahabharat generator page |
| GET | `/health` | Railway health check |
| POST | `/api/generate-affirmation` | Affirmations video (DALL-E + Sharp + FFmpeg) |
| POST | `/api/generate-mahabharat` | Generate Mahabharat script (Claude) |
| POST | `/api/generate-mahabharat-video` | Full video (script → images → composite → FFmpeg → Cloudinary → YouTube) |
| POST | `/api/mahabharat-scene-prompts` | Returns 4 Claude scene prompts (no image gen) |
| POST | `/api/build-mahabharat-from-images` | Build video from 4 user-uploaded images (multipart) |
| POST | `/api/generate-sameta` | Full Sameta video → Cloudinary → YouTube/Instagram/Facebook |
| POST | `/api/trigger-mahabharat-cron` | Manually fire Mahabharat cron (protected by ADMIN_SECRET) |
| GET | `/api/download` | Proxy download for iOS Save to Photos |
| GET | `/auth/youtube?channel=<service>` | Redirect to Google OAuth (per service) |
| GET | `/auth/youtube/callback` | OAuth2 callback (routes back to / or /setup by service) |
| GET | `/auth/youtube/status?channel=<service>` | Check YouTube connection per service |
| POST | `/auth/youtube/disconnect?channel=<service>` | Disconnect YouTube per service |
| GET | `/auth/meta` | Redirect to Meta OAuth |
| GET | `/auth/meta/status` | Check Meta (Instagram/Facebook) connection |
| POST | `/auth/meta/disconnect` | Disconnect Meta |

---

## ✅ What's Done

### Affirmations & Positive Vibes Tab (NEW — replaced Motivation tab)
- [x] `affirmation_video_gen.js` — full cinematic pipeline
- [x] DALL-E 3 (1024×1792) full-bleed background — culturally tuned prompts (South Indian for Telugu, universal nature for English)
- [x] Claude generates quote + subtext (`{quote, subtext}` JSON)
- [x] Claude generates DALL-E background prompt tuned to language + affirmation type
- [x] Sharp compositing: top gradient + category label (gold) + bottom gradient (58%) + quote lines + gold divider + subtext + branding
- [x] Caveat-Bold.ttf for English, NotoSansTelugu.ttf for Telugu
- [x] FFmpeg 15s smooth pan video (scale 108%, t-based crop pan)
- [x] **5 types:** Morning (🌅), Positive Vibes (✨), Gratitude (🙏), Self Love (💚), Success (🏆)
- [x] **2 languages:** English + Telugu
- [x] Optional custom quote input (AI generates if blank)
- [x] Cloudinary upload — raw image + composited image (background + quote overlay)
- [x] **Per-service YouTube** (`channel=affirmation` → own token, own channel)
- [x] Instagram Reels + Facebook publish (Meta Graph API)
- [x] **WhatsApp Content Pack** — copy caption, copy tags, save quote image (composited), save video, save plain background (for Veo/Flow)
- [x] Result shows quote text + subtext inline

### Mahabharat Tab
- [x] Claude (`claude-sonnet-4-6`) generates full 30s Telugu scripts (hook/story/lesson/CTA)
- [x] **Gemini Imagen 3** generates 4 scene images (tries 3 models in order)
- [x] **DALL-E 3 fallback** — enabled for cron jobs (`allowDallEFallback: true`), disabled for manual (cost control)
- [x] Sharp composites: 4 scenes — EP badge (top-left), character name (top-right), section text, branding
- [x] Ken Burns smooth pan per clip (scale 112% + t-based crop, alternating L→R and R→L)
- [x] FFmpeg concat demuxer (sequential, OOM-safe on Railway)
- [x] Cloudinary upload — video + raw image + **composited scene-0 image** (with text overlay)
- [x] **YouTube hook as title** — hook text = YouTube title (scroll-stopper), `script.title` in description
- [x] YouTube description with blank lines between sections (hook / story / lesson / CTA)
- [x] Optional YouTube upload (Mahabharat-specific OAuth token)
- [x] Auto-scheduler: 10 AM + 6 PM IST (`mahabharatScheduler.js`)
- [x] Manual cron trigger via `/api/trigger-mahabharat-cron`
- [x] Episode counter persists in `output/.mb_ep_counter`
- [x] **Manual image flow** — get 4 Claude scene prompts → copy to Gemini Studio → upload 4 images → build video
- [x] `imageForFlow()` widget — DALL-E raw image + Google Flow / Veo animation steps
- [x] **WhatsApp Content Pack** — save quote image (composited), save video, save raw image (for Flow/Veo)
- [x] Download to phone button (iOS Camera Roll via `/api/download` proxy)

### Sameta Tab
- [x] Claude picks random Telugu proverb (12-category rotation)
- [x] No-repeat system: tracks last 500 sametas in `output/.sameta_used.json`
- [x] DALL-E generates illustrated scene
- [x] Sharp compositing: cream overlay + Telugu sameta text + gradient
- [x] Cloudinary upload (video + image)
- [x] **Per-service YouTube** (`channel=sameta` → own token, own channel)
- [x] Instagram Reels + Facebook Video (Meta Graph API)
- [x] `imageForFlow()` widget — raw image + Google Flow steps
- [x] **WhatsApp Content Pack** — copy caption, copy tags, save image, save video

### Per-Service YouTube Channels (NEW)
- [x] `auth.js` supports 4 separate tokens: `affirmation`, `sameta`, `mahabharat`, `default`
- [x] Each stored in its own file under `output/`
- [x] Session keys: `affYtToken` (affirmation), `youtubeRefreshToken` (sameta/default), `mbRefreshToken` (mahabharat)
- [x] Connect button per tab links to correct OAuth flow (`?channel=<service>`)
- [x] After OAuth, redirects back to correct tab (`/?youtube=connected&service=<channel>`)
- [x] Status shows connected channel name (e.g. "▶ My Affirmation Channel")
- [x] Disconnect per service without affecting other channels

### Meta (Instagram + Facebook)
- [x] Shared across Affirmations + Sameta (one Meta account)
- [x] Connect banner visible on both tabs
- [x] Disconnect on either tab updates both banners

### UI / UX
- [x] Channel cards bar **removed** — nav tabs at top are the only navigation (cleaner)
- [x] Each tab has its own connection banners inside the tab content
- [x] Platform checkboxes (YouTube / Instagram / Facebook) on Affirmations + Sameta tabs
- [x] Tab persistence through OAuth redirects (sessionStorage)
- [x] Toast notification on OAuth return (`?youtube=connected`)
- [x] Smooth affirmation type chip selection (pill buttons)

### Infrastructure
- [x] Railway deployment: Dockerfile + nixpacks.toml + railway.json
- [x] `scheduler.js` — `cleanup()` function fix (was crashing with `cleanup is not defined`)
- [x] FFmpeg Ken Burns: replaced `zoompan` (stuttery) with `scale+crop t-based pan`
- [x] FFmpeg merge: replaced `filter_complex xfade` (OOM) with concat demuxer
- [x] Pango markup fix: all `rgba()` colors replaced with hex (Pango XML parser rejects rgba)

---

## 🔲 Pending / Known Issues

### Medium Priority
1. **Sameta auto-scheduler** — No cron job for Sameta (only Mahabharat has one)
2. **Affirmations auto-scheduler** — Could add 3x/day posting (currently manual only)
3. **Session token persistence** — YouTube tokens are session + file; wiped if Railway ephemeral FS resets. Mitigation: use Railway env vars for cron-channel tokens
4. **ElevenLabs on Railway** — API calls time out from Railway's IP range. Workaround: `E2E_SKIP_VOICE=1`
5. **Video history** — No record of past generations. Fix: Postgres or Supabase

### Low Priority
6. **WhatsApp Business API** — User interested in auto-posting daily content pack to WhatsApp groups (requires WATI/AiSensy ~₹2,499/mo for broadcast)
7. **Google Flow / Veo integration** — Currently shows manual steps. Could automate if Flow API becomes available
8. **Async job queue** — Long FFmpeg jobs can hit Railway timeout. Fix: BullMQ + Redis
9. **TikTok upload** — Currently Instagram + Facebook + YouTube only
10. **Analytics dashboard** — YouTube video performance metrics

---

## Environment Variables Reference

```env
PORT=3000

ANTHROPIC_API_KEY=              # Claude (all pipelines)
OPENAI_API_KEY=                 # DALL-E 3 (Affirmations primary; Mahabharat fallback)
GEMINI_API_KEY=                 # Gemini Imagen 3 (Mahabharat primary)

ELEVENLABS_API_KEY=             # TTS — not working on Railway, use E2E_SKIP_VOICE=1
ELEVENLABS_VOICE_ID=            # Default: Rachel

# YouTube — per-service tokens
YOUTUBE_CLIENT_ID=              # Google OAuth2 credentials (shared across all services)
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REFRESH_TOKEN=          # Sameta / default channel token (legacy)
MAHABHARAT_YOUTUBE_REFRESH_TOKEN=  # Mahabharat channel token (for cron auto-publish)
# Affirmation token stored in output/.youtube_affirmation_token (set via UI)

MAHABHARAT_AUTO_PUBLISH=true    # Enable 10AM+6PM IST auto-scheduler
MAHABHARAT_ZOOM=false           # Enable Ken Burns zoom (default: false, faster)

META_APP_ID=                    # Facebook App ID
META_APP_SECRET=                # Facebook App Secret

CLOUDINARY_CLOUD_NAME=          # CDN for public video + image URLs
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

ADMIN_SECRET=                   # Protects /api/trigger-mahabharat-cron
SESSION_SECRET=                 # Express session signing key

E2E_TEST_MODE=0                 # 1 = short videos (saves API credits in testing)
E2E_SKIP_VOICE=1                # 1 = skip ElevenLabs (Railway workaround)
MOTIVATIONAL_CHANNEL_NAME=      # Shown in legacy motivation videos

AUTO_PUBLISH=true               # Enable motivation scheduler (6 AM, 3 PM, 9 PM UTC)
SCHEDULE_TIMEZONE=Asia/Kolkata  # Scheduler timezone (default: UTC)
```

---

## Video Specs

- Format: 1080×1920 (9:16 vertical), H.264 MP4
- Duration: 15s (Affirmations), ~30s (Mahabharat / Sameta)
- Frame rate: 30fps
- Affirmations: full-bleed DALL-E background + dark gradients + centered quote text
- Mahabharat: 4 scenes × 7.5s; EP badge + character name + section text on each scene
- Sameta: cream overlay (45% height) + Telugu proverb text + DALL-E illustrated scene

---

## Deployment Notes

- **Railway** uses `Dockerfile` (defined in `railway.json`)
- FFmpeg installed via Dockerfile; nixpacks.toml is a fallback
- Health check: `GET /health` → `{"status":"ok"}`
- Output dir `output/` is created at startup; may be wiped on redeploy (ephemeral FS)
- Cloudinary free plan: 25GB storage / 25GB bandwidth — enough for ~500–1000 videos
- Set `MAHABHARAT_YOUTUBE_REFRESH_TOKEN` in Railway Variables for cron auto-posting
- Gemini free tier: ~50 requests/day; if quota hit during cron, DALL-E fallback kicks in automatically
