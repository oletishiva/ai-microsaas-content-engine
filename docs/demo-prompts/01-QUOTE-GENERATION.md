# Section 1: Quote / Script Generation (OpenAI)

**Goal:** Given a topic, call OpenAI GPT-4o to generate a short script (~35 words) + a hook (first few words for the video overlay).

---

## Prompt to Paste in Cursor

```
Add script generation using OpenAI.

Create src/services/scriptGenerator.js:

- Function: generateScript(topic, opts)
- Uses OpenAI chat completions (gpt-4o)
- System prompt: "You are a viral copywriter for short-form videos (YouTube Shorts). STRICT: max 35 words, max 200 chars. Structure: Hook → Problem → Solution → CTA. Punchy, urgent. Output ONLY the script text."
- User prompt: "Write a 15-second marketing script (35 words) for: {topic}. Use the full word count."
- If topic contains "quotation" or "quote" or "wisdom" or "inspirational": use a different prompt that asks for a real famous quote + 1 line of context
- Return { script: string, hook: string }
- Hook = first sentence, truncated to ~3–5 words if long, UPPERCASE
- Enforce limits: truncate script if over 35 words or 200 chars
- Use OPENAI_API_KEY from config/apiKeys
- Log errors clearly
```

---

## What You Need

- `OPENAI_API_KEY` in `.env` (from platform.openai.com)

---

## API Shape

```js
const { generateScript } = require('./services/scriptGenerator');

const { script, hook } = await generateScript("morning motivation");
// script: "Rise before the sun. Your best self waits in the quiet hours. One habit changes everything. Start tomorrow."
// hook: "RISE BEFORE THE SUN"
```

---

## Test It

Add a quick test route or script:

```js
const { generateScript } = require('./services/scriptGenerator');
generateScript("world famous quotation").then(r => console.log(r));
```

---

## Next

→ [02-ELEVENLABS](02-ELEVENLABS.md)
