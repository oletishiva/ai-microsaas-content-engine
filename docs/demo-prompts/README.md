# Demo Prompts – AI Content Engine (E2E Build)

**For vibe coders.** Paste these prompts into Cursor one section at a time in a **new, empty project**. Each file is self-contained. You don't need to know anything—just follow the order.

---

## Order of Execution

| # | Section | What it does |
|---|---------|--------------|
| 0 | [00-SETUP](00-SETUP.md) | Node + Express + .env + folder structure |
| 1 | [01-QUOTE-GENERATION](01-QUOTE-GENERATION.md) | OpenAI → script + hook for video |
| 2 | [02-ELEVENLABS](02-ELEVENLABS.md) | Script → voice MP3 (ElevenLabs TTS) |
| 3 | [03-PEXELS](03-PEXELS.md) | Topic → images from Pexels (9:16) |
| 4 | [04-AUDIO-MIXING](04-AUDIO-MIXING.md) | Voice + background music → mixed MP3 |
| 5 | [05-VIDEO-ASSEMBLY](05-VIDEO-ASSEMBLY.md) | Images + audio + overlays → MP4 (FFmpeg) |
| 6 | [06-CLOUDINARY](06-CLOUDINARY.md) | Upload video → public URL |
| 7 | [07-YOUTUBE-VIRAL](07-YOUTUBE-VIRAL.md) | Upload to YouTube with viral Shorts tags |
| 8 | [08-ORCHESTRATION](08-ORCHESTRATION.md) | Wire all steps into POST /api/generate-video |

---

## How to Use

1. Create a new folder for your project.
2. Open Cursor in that folder.
3. Start with **00-SETUP.md** – paste the whole prompt, let Cursor build it.
4. Move to **01-QUOTE-GENERATION.md** – paste, integrate.
5. Repeat for each section in order.

Each prompt includes:
- What you need (API keys, env vars)
- What to paste / ask Cursor
- What the output should look like

---

## API Keys You'll Need

| Key | Where |
|-----|-------|
| `OPENAI_API_KEY` | platform.openai.com |
| `ELEVENLABS_API_KEY` | elevenlabs.io |
| `PEXELS_API_KEY` | pexels.com/api |
| `CLOUDINARY_*` | cloudinary.com |
| `YOUTUBE_*` | Google Cloud Console |

---

*Built for the AI Content Engine demo.*
