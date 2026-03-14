# Section 2: ElevenLabs Voice (TTS)

**Goal:** Take the script text and convert it to spoken MP3 using ElevenLabs Text-to-Speech.

---

## Prompt to Paste in Cursor

```
Add voice generation using ElevenLabs TTS.

Create src/services/voiceGenerator.js:

- Function: generateVoice(script)
- POST to https://api.elevenlabs.io/v1/text-to-speech/{voiceId}?output_format=mp3_44100_128
- Headers: xi-api-key (from ELEVENLABS_API_KEY), Content-Type: application/json
- Body: { text: script, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }
- responseType: arraybuffer (axios)
- Save response to output/narration.mp3
- Return the absolute path to the saved file
- Voice ID from env ELEVENLABS_VOICE_ID or default "EXAVITQu4vr4xnSDxMaL" (Rachel)
- Handle errors: if 401, say "Check ELEVENLABS_API_KEY"; if 429, say "Rate limited"
- Use OUTPUT_DIR from config/paths
```

---

## What You Need

- `ELEVENLABS_API_KEY` in `.env` (from elevenlabs.io → Profile → API Key)
- Optional: `ELEVENLABS_VOICE_ID` – pick from ElevenLabs Voice Library

---

## API Shape

```js
const { generateVoice } = require('./services/voiceGenerator');

const audioPath = await generateVoice("Rise before the sun. Your best self waits.");
// Returns: /absolute/path/to/output/narration.mp3
```

---

## Test It

```js
const { generateVoice } = require('./services/voiceGenerator');
generateVoice("Hello, this is a test.").then(p => console.log("Saved:", p));
```

---

## Next

→ [03-PEXELS](03-PEXELS.md)
