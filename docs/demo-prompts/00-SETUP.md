# Section 0: Project Setup

**Goal:** Empty Node + Express app with .env, folders, and a health check. Nothing fancy.

---

## Prompt to Paste in Cursor

```
I'm building an AI Content Engine that generates 15-second YouTube Shorts from a topic.

Set up a fresh Node.js + Express project with:

1. package.json with: express, dotenv, axios, openai
2. A .env file (create .env.example too) with placeholders for:
   - OPENAI_API_KEY
   - ELEVENLABS_API_KEY
   - PEXELS_API_KEY
   - ELEVENLABS_VOICE_ID (optional, default voice)
3. Folder structure:
   - src/
   - src/services/
   - config/
   - utils/
   - output/ (gitignore this)
   - media/ (gitignore this)
4. config/apiKeys.js – load env vars with dotenv, export them. Validate that OPENAI_API_KEY, ELEVENLABS_API_KEY, PEXELS_API_KEY exist at startup (throw clear error if missing).
5. config/paths.js – export OUTPUT_DIR = path.join(__dirname, '..', 'output') and MEDIA_DIR for downloaded images.
6. src/app.js – Express app, JSON body parser, GET /health returns { status: "ok" }, GET / returns { name: "AI Content Engine", endpoints: { health: "GET /health" } }
7. .gitignore – node_modules, .env, output/, media/
8. FFmpeg must be installed – add a note in README: brew install ffmpeg (macOS)

Start the server on PORT from env or 3000. Keep it minimal.
```

---

## What You Need

- Node.js 18+
- FFmpeg installed: `brew install ffmpeg` (macOS) or `sudo apt install ffmpeg` (Linux)

---

## After Running

- `npm install`
- Create `.env` with your keys (copy from `.env.example`)
- `npm start`
- Visit `http://localhost:3000` → should see JSON with `name: "AI Content Engine"`
- Visit `http://localhost:3000/health` → `{ "status": "ok" }`

---

## Next

→ [01-QUOTE-GENERATION](01-QUOTE-GENERATION.md)
