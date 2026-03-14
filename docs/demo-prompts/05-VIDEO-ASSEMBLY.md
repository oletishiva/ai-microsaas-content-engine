# Section 5: Video Assembly (FFmpeg)

**Goal:** Combine images + audio into a vertical 9:16 MP4. Add hook + quote text overlays.

---

## Prompt to Paste in Cursor

```
Add video assembly with FFmpeg.

1. Create utils/textToImage.js:
   - renderTextToImage(text, outputPath, options)
   - Use Sharp + SVG to create PNG with white text, black outline
   - Options: fontSize, videoWidth (1080), maxCharsPerLine (14 for hook, 18 for quote)
   - Text area: 80% width (10% margins each side) – avoid clipping
   - Wrap long text into multiple lines
   - Return outputPath

2. Create src/services/videoGenerator.js:
   - generateVideo(imagePaths, audioPath, script, hookText, outputFilename)
   - Video: 1080x1920 (9:16), 25fps
   - Each image shown for (audioDuration / imageCount) seconds
   - Use FFmpeg concat filter (not demuxer) to combine images
   - Scale each image to 1080x1920, crop center
   - Overlays: hook for first 3.5s (large text), quote (script) for rest
   - Overlay position: y = 15% from top, centered
   - Output: libx264, aac, movflags +faststart, yuv420p
   - Return path to output MP4

3. Hook overlay: first 3.5 seconds, bold
4. Quote overlay: from 3.5s to end, smaller font
5. Use OUTPUT_DIR from config/paths
```

---

## What You Need

- FFmpeg + FFprobe
- Sharp: `npm install sharp`

---

## API Shape

```js
const { generateVideo } = require('./services/videoGenerator');

const videoPath = await generateVideo(
  imagePaths,
  audioPath,
  "Full script text here...",
  "STOP SCROLLING",
  "video_123.mp4"
);
// Returns: /path/to/output/video_123.mp4
```

---

## Key FFmpeg Concepts

- Concat filter: scale each image, concat=n=N:v=1
- Overlay: overlay=x=(W-w)/2:y=H*0.15
- Enable by time: enable='between(t,0,3.5)' for hook, enable='gte(t,3.5)' for quote

---

## Next

→ [06-CLOUDINARY](06-CLOUDINARY.md)
