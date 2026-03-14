# Section 8: Orchestration (Wire It All)

**Goal:** One API endpoint that runs the full pipeline: topic → script → voice → images → audio mix → video → Cloudinary → YouTube.

---

## Prompt to Paste in Cursor

```
Wire the full pipeline into one API endpoint.

Create src/routes/generateVideo.js (or add to app):

POST /api/generate-video

Request body: { topic: string, script?: string, imageQuery?: string, imageCount?: number, showQuote?: boolean, addMusic?: boolean, hook?: string }

Flow:
1. Get topic (required if no script) or script from body
2. If no script: generateScript(topic) → script, hook. Else use provided script, derive hook from first sentence
3. fetchImages(imageQuery || topic, imageCount || 4) → imagePaths
4. generateVoice(script) → voicePath
5. If addMusic and music folder has files: fetchBackgroundMusic() + mixVoiceWithMusic(voicePath, musicPath, mixedPath) → use mixedPath. Else use voicePath
6. generateVideo(imagePaths, audioPath, showQuote ? script : null, hook) → videoPath
7. If Cloudinary configured: uploadVideoToCloudinary(videoPath) → videoUrl. Optionally delete local file after upload
8. If YouTube configured: generate thumbnail (first image + hook text), uploadToYouTube(videoPath, title, desc, { topic, thumbnailPath }) → youtubeUrl
9. Return { success: true, script, videoUrl?, youtubeUrl?, videoPath? }

Handle errors: wrap in try/catch, return 500 with error message.
Validate: topic or script required.
```

---

## Optional: Web UI

```
Add a simple web UI at GET / that shows a form:
- Topic input
- Script (optional textarea)
- Image count dropdown (3-10)
- Show quote overlay checkbox (default ON)
- Add music checkbox (default ON)
- Generate Video button

On submit: POST /api/generate-video with form data, show result (video URL, YouTube URL).
Use fetch(), no framework. Dark theme, mobile-friendly.
```

---

## Test the Full Pipeline

```bash
curl -X POST http://localhost:3000/api/generate-video \
  -H "Content-Type: application/json" \
  -d '{"topic": "morning motivation", "imageCount": 4}'
```

Expected: `{ "success": true, "videoUrl": "...", "youtubeUrl": "..." }`

---

*Pipeline complete. Demo ready.*
