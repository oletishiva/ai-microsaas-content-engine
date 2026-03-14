# Section 7: YouTube Publish (Viral Shorts)

**Goal:** Upload the video to YouTube with viral Shorts tags, OAuth2, and optional custom thumbnail.

---

## Prompt to Paste in Cursor

```
Add YouTube upload with viral Shorts optimization.

1. npm install googleapis

2. Create src/services/youtubeUploader.js:
   - uploadToYouTube(videoPath, title, description, opts)
   - opts: { topic, tags, privacyStatus, thumbnailPath }
   - Use Google OAuth2 with refresh token (YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN, YOUTUBE_REDIRECT_URI)
   - YouTube Data API v3: videos.insert (snippet, status)
   - Category: 22 (People & Blogs)
   - Build viral tags: combine topic keywords + ["shorts", "viral", "motivation", "inspirational", "success", "mindset", "daily motivation", "trending", "life tips", "goals"]
   - Max 500 chars total for tags, each tag max 30 chars
   - If thumbnailPath provided and file exists: youtube.thumbnails.set after upload
   - Return full video URL: https://www.youtube.com/watch?v={videoId}

3. Create scripts/get-youtube-refresh-token.js:
   - One-time script to get refresh token
   - Start local server, open auth URL, capture code from redirect
   - Exchange code for refresh token, print it
   - User adds YOUTUBE_REFRESH_TOKEN to .env
```

---

## What You Need

- Google Cloud project with YouTube Data API v3 enabled
- OAuth2 credentials (Web application)
- Redirect URI: http://localhost:3000/oauth2callback (or your app URL)
- Run `node scripts/get-youtube-refresh-token.js` once to get refresh token

---

## API Shape

```js
const { uploadToYouTube } = require('./services/youtubeUploader');

const url = await uploadToYouTube(
  "/path/to/video.mp4",
  "Morning Motivation #Shorts",
  "Script: ...",
  { topic: "morning motivation", privacyStatus: "public", thumbnailPath: "/path/to/thumb.jpg" }
);
// Returns: "https://www.youtube.com/watch?v=abc123"
```

---

## Viral Tags (Built-in)

shorts, viral, motivation, motivational, inspiration, motivational quotes, success, mindset, daily motivation, trending, lifestyle, life tips, self improvement, mindset matters, goals

---

## Note on Shorts Thumbnails

YouTube Shorts auto-generate thumbnails from video frames. Custom thumbnail API may not apply. Show hook for first 3.5s so YouTube picks a good frame.

---

## Next

→ [08-ORCHESTRATION](08-ORCHESTRATION.md) – Wire all steps into one API
