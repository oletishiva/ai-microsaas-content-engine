# Section 4: Audio Mixing (Voice + Music)

**Goal:** Mix voice narration with background music. Music at ~20% volume, voice at 100%. Use FFmpeg.

---

## Prompt to Paste in Cursor

```
Add audio mixing: voice + background music.

1. Create utils/ffmpegHelper.js:
   - getAudioDuration(filePath) – use ffprobe to return duration in seconds
   - Use child_process.execSync or similar

2. Create utils/audioMixer.js:
   - mixVoiceWithMusic(voicePath, musicPath, outputPath, opts)
   - opts.musicOnly = true when no voice (use music at full volume)
   - Trim music to 15s–35s segment (avoid intro)
   - Voice at 100%, music at 20%
   - FFmpeg filter: amix, duration=shortest
   - Output: stereo, 44100 Hz, good quality
   - Return outputPath

3. Create src/services/musicFetcher.js:
   - fetchBackgroundMusic() – pick random MP3 from ./music/ folder
   - Return path or null if folder empty
   - Create ./music/ folder, add a sample MP3 or document that user must add their own
```

---

## What You Need

- FFmpeg installed
- Optional: Add 1–3 MP3 files to `./music/` for background music (or skip music for now)

---

## API Shape

```js
const { mixVoiceWithMusic } = require('./utils/audioMixer');
const { fetchBackgroundMusic } = require('./services/musicFetcher');

const musicPath = fetchBackgroundMusic();
const mixedPath = await mixVoiceWithMusic(voicePath, musicPath, "output/mixed.mp3");
// mixedPath = path to final audio
```

---

## FFmpeg Hint

Voice + music mix (music at 0.2 volume):
```
ffmpeg -i voice.mp3 -ss 15 -i music.mp3 -filter_complex "[0:a]volume=1[a0];[1:a]atrim=0:20,volume=0.2[a1];[a0][a1]amix=inputs=2:duration=shortest" -ac 2 -ar 44100 output.mp3
```

---

## Next

→ [05-VIDEO-ASSEMBLY](05-VIDEO-ASSEMBLY.md)
