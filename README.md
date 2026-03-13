# 🎬 AI Content Engine

A **Micro SaaS** that automatically generates short-form vertical videos (YouTube Shorts) from any topic — powered by OpenAI, ElevenLabs, Pexels, FFmpeg, and the YouTube Data API.

---

## 🚀 How It Works

```
Topic (text input)
    │
    ▼
[1] OpenAI GPT-4o       → Generates a 60–90 sec video narration script
    │
    ▼
[2] ElevenLabs TTS      → Converts script to MP3 voice narration
    │
    ▼
[3] Pexels API          → Downloads relevant portrait images
    │
    ▼
[4] FFmpeg              → Assembles images + audio into a 9:16 vertical MP4
    │
    ▼
[5] YouTube Data API    → Uploads the finished video to YouTube
```

---

## 📁 Project Structure

```
ai-microsaas-content-engine/
├── config/
│   ├── apiKeys.js              # Central API key loader
│   └── cloudinary.js            # Cloudinary config (video uploads)
├── src/
│   ├── services/
│   │   ├── scriptGenerator.js  # OpenAI script generation
│   │   ├── voiceGenerator.js   # ElevenLabs TTS
│   │   ├── imageFetcher.js     # Pexels image downloader
│   │   ├── videoGenerator.js   # FFmpeg video assembler
│   │   ├── cloudinaryUploader.js # Cloudinary video upload
│   │   └── youtubeUploader.js  # YouTube OAuth2 uploader
│   ├── routes/
│   │   └── generateVideo.js    # POST /api/generate-video
│   └── app.js                  # Express entry point
├── utils/
│   └── ffmpegHelper.js         # FFmpeg concat + probe utilities
├── output/                     # Runtime-generated files (gitignored)
├── .env                        # API keys (never commit with real values!)
├── .gitignore
└── package.json
```

---

## ⚙️ Prerequisites

- **Node.js** v18+
- **FFmpeg** installed and in your PATH
  ```bash
  # macOS
  brew install ffmpeg

  # Ubuntu/Debian
  sudo apt install ffmpeg
  ```

---

## 🛠️ Setup

### 1. Clone & install dependencies
```bash
git clone <your-repo-url>
cd ai-microsaas-content-engine
npm install
```

### 2. Configure API Keys
Copy the `.env` file and fill in your keys:

```bash
cp .env .env.local  # optional – or just edit .env directly
```

| Variable | Where to get it |
|---|---|
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys |
| `ELEVENLABS_API_KEY` | https://elevenlabs.io → Profile → API Key |
| `ELEVENLABS_VOICE_ID` | ElevenLabs Voice Library (default: Rachel) |
| `PEXELS_API_KEY` | https://www.pexels.com/api/ |
| `YOUTUBE_CLIENT_ID` | Google Cloud Console → Credentials |
| `YOUTUBE_CLIENT_SECRET` | Google Cloud Console → Credentials |
| `YOUTUBE_REFRESH_TOKEN` | See YouTube OAuth2 setup below |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary Dashboard → Settings |
| `CLOUDINARY_API_KEY` | Cloudinary Dashboard → Settings |
| `CLOUDINARY_API_SECRET` | Cloudinary Dashboard → Settings |

### 3. YouTube OAuth2 Setup (one-time)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → Enable **YouTube Data API v3**
3. Create **OAuth 2.0 credentials** (Web Application type)
4. Add `http://localhost:3000/oauth2callback` as an authorised redirect URI
5. Add `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` to `.env`
6. Run the auth script and follow the prompts:
   ```bash
   npm run youtube:auth
   ```
7. Visit the printed URL, sign in with Google, authorize → the refresh token will appear
8. Add `YOUTUBE_REFRESH_TOKEN=...` to `.env`
9. **Test without using OpenAI/ElevenLabs/Pexels:**
   ```bash
   npm run youtube:test
   ```
   This creates a 2-second test video with FFmpeg and uploads it to YouTube (private). No paid APIs used.

### 4. Cloudinary Setup (optional – for public video URLs)

1. Create a free account at [Cloudinary](https://cloudinary.com/)
2. Go to **Dashboard** → **Settings** (or [console](https://console.cloudinary.com/))
3. Copy your **Cloud name**, **API Key**, and **API Secret**
4. Add to `.env`:
   ```
   CLOUDINARY_CLOUD_NAME=your_cloud_name
   CLOUDINARY_API_KEY=your_api_key
   CLOUDINARY_API_SECRET=your_api_secret
   ```
5. When configured, generated videos are uploaded to Cloudinary and the API returns a public `videoUrl` instead of a local `videoPath`. The local file is deleted after upload to save disk space (important for Railway).

---

## ▶️ Running the Server

```bash
# Production
npm start

# Development (auto-restarts on file changes)
npm run dev
```

Server starts at: **http://localhost:3000**

---

## 📡 API Usage

### `POST /api/generate-video`

**Request:**
```bash
curl -X POST http://localhost:3000/api/generate-video \
  -H "Content-Type: application/json" \
  -d '{ "topic": "The future of artificial intelligence" }'
```

**Response (with Cloudinary configured):**
```json
{
  "success": true,
  "topic": "The future of artificial intelligence",
  "script": "AI is no longer science fiction...",
  "videoUrl": "https://res.cloudinary.com/your-cloud/video/upload/ai-content-engine/video_123.mp4",
  "youtubeUrl": "https://www.youtube.com/watch?v=abc123"
}
```

**Response (without Cloudinary):**
```json
{
  "success": true,
  "topic": "The future of artificial intelligence",
  "script": "AI is no longer science fiction...",
  "videoPath": "/absolute/path/to/output/video_123.mp4",
  "youtubeUrl": "https://www.youtube.com/watch?v=abc123"
}
```

---

## 💡 Workshop Tips

1. **Test each service independently** before running the full pipeline — add a small `test.js` next to each service file.
2. **Start with YouTube privacy set to `"private"`** (already the default) until you're happy with the output.
3. **Change the voice** by swapping `ELEVENLABS_VOICE_ID` in `.env` — browse voices at [ElevenLabs Voice Library](https://elevenlabs.io/voice-library).
4. **Tweak image count** by changing the `count` argument in the `fetchImages` call inside `generateVideo.js`.
5. **Add captions** by piping the script to FFmpeg's `drawtext` filter in `videoGenerator.js`.

---

---

## 🚂 Railway Deployment

### Prerequisites
- [Railway](https://railway.app) account
- GitHub repo (or deploy from CLI)

### Deploy Steps

1. **Create a new project** on [Railway](https://railway.app) and connect your GitHub repo.

2. **Add environment variables** in Railway → Your Service → Variables:
   | Variable | Required | Description |
   |----------|----------|-------------|
   | `OPENAI_API_KEY` | ✅ | OpenAI API key |
   | `ELEVENLABS_API_KEY` | ✅ | ElevenLabs API key |
   | `PEXELS_API_KEY` | ✅ | Pexels API key |
   | `ELEVENLABS_VOICE_ID` | ❌ | Default: Rachel |
   | `E2E_TEST_MODE` | ❌ | Set to `1` for testing (fewer credits) |
   | `E2E_SKIP_VOICE` | ❌ | Set to `1` to bypass ElevenLabs (use silent audio) when free tier blocks cloud IPs |
   | `YOUTUBE_CLIENT_ID` | ❌ | For YouTube uploads |
   | `YOUTUBE_CLIENT_SECRET` | ❌ | For YouTube uploads |
   | `YOUTUBE_REFRESH_TOKEN` | ❌ | For YouTube uploads |
   | `YOUTUBE_REDIRECT_URI` | ❌ | `https://your-app.railway.app/oauth2callback` for OAuth |
   | `CLOUDINARY_CLOUD_NAME` | ❌ | For public video URLs (recommended on Railway) |
   | `CLOUDINARY_API_KEY` | ❌ | For Cloudinary uploads |
   | `CLOUDINARY_API_SECRET` | ❌ | For Cloudinary uploads |
   | `RAILPACK_DEPLOY_APT_PACKAGES` | ✅ | **Required for video generation.** Set to `ffmpeg libatomic1` so FFmpeg is available at runtime. |

3. **FFmpeg** is installed automatically via `nixpacks.toml`.

4. **Deploy** – Railway detects Node.js, runs `npm install`, then `npm start` (from Procfile).

5. **Health check**: `GET https://your-app.railway.app/health` → `{"status":"ok"}`

6. **Add FFmpeg for video generation** – In Variables, add:
   ```
   RAILPACK_DEPLOY_APT_PACKAGES=ffmpeg libatomic1
   ```
   This installs FFmpeg in the runtime image. Without it, video generation fails with "FFmpeg validation failed".

7. **Generate video**:
   ```bash
   curl -X POST https://your-app.railway.app/api/generate-video \
     -H "Content-Type: application/json" \
     -d '{"topic": "AI productivity tips"}'
   ```

### Fix: "secret App: not found" build error

If builds fail with `secret App: not found`, try:

1. **Add a dummy variable** in Railway → Variables: create variable `App` with value `1` (satisfies the secret lookup).
2. **Rename the service** from "App" to "web" in Settings if your service is named "App".
3. **Check variable references** – remove any variable using `${{App.xxx}}` if you have no service named "App".

### n8n Integration
- **URL**: `https://your-app.railway.app/api/generate-video`
- **Method**: POST
- **Body**: `{"topic": "{{ $json.topic }}"}`
- **Response**: Use `{{ $json.videoUrl }}` for the public video URL (when Cloudinary is configured)

---

## 📜 License

MIT
