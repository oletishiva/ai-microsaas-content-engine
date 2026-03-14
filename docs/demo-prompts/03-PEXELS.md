# Section 3: Pexels Images

**Goal:** Search Pexels for images matching the topic, prefer portrait (9:16), download them for the video.

---

## Prompt to Paste in Cursor

```
Add image fetching from Pexels.

Create src/services/imageFetcher.js:

- Function: fetchImages(topic, count = 8)
- GET https://api.pexels.com/v1/search?query={topic}&per_page=30
- Header: Authorization: PEXELS_API_KEY
- Try orientation=portrait first (native 9:16 for Shorts)
- Fallback: no orientation (landscape) – we'll crop to 9:16 in FFmpeg
- Combine portrait + landscape, dedupe by photo id
- Pick image URLs: prefer original or large2x (use large2x on Railway if env RAILWAY_PROJECT_ID to save memory)
- Download each to media/run_{timestamp}_{random}/image_0.jpg, image_1.jpg, ...
- Return array of absolute file paths
- If no results, throw clear error
- Use MEDIA_DIR from config/paths
- Create media dir if it doesn't exist
```

---

## What You Need

- `PEXELS_API_KEY` in `.env` (from pexels.com/api)

---

## API Shape

```js
const { fetchImages } = require('./services/imageFetcher');

const paths = await fetchImages("morning motivation", 4);
// Returns: ["/path/media/run_xxx/image_0.jpg", "/path/media/run_xxx/image_1.jpg", ...]
```

---

## Test It

```js
const { fetchImages } = require('./services/imageFetcher');
fetchImages("nature landscape", 3).then(p => console.log("Images:", p));
```

---

## Next

→ [04-AUDIO-MIXING](04-AUDIO-MIXING.md)
