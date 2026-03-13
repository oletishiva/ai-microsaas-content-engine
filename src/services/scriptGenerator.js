/**
 * src/services/scriptGenerator.js
 * ---------------------------------
 * STEP 1: Generate short-form marketing scripts (max 35 words, 200 chars)
 * Structure: Hook → Problem → Solution → CTA
 * Optimized for ElevenLabs credit savings.
 */

const OpenAI = require("openai");
const { OPENAI_API_KEY } = require("../../config/apiKeys");
const logger = require("../../utils/logger");

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const MAX_WORDS = 35;
const MAX_CHARS = 200;
const MAX_WORDS_LONG = 50; // ~20 sec at 150 wpm; Shorts allow up to 60 sec
const MAX_CHARS_LONG = 280;
const E2E_TEST_WORDS = 15;
const E2E_TEST_CHARS = 100;

/**
 * generateScript
 * @param {string} topic - Marketing topic/product
 * @param {boolean} e2eTestMode - If true, use shorter limits to save ElevenLabs credits
 * @param {Object} [opts] - { maxWords: number } override (35 default, 50 for longer scripts)
 * @returns {Promise<{ script: string, hook: string }>} - Script + hook for overlay
 */
async function generateScript(topic, e2eTestMode = false, opts = {}) {
    if (!OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not set in .env");
    }
    logger.info("ScriptGenerator", `Generating script for topic: "${topic}"`);

    const maxWords = e2eTestMode ? E2E_TEST_WORDS : (opts.maxWords ?? MAX_WORDS);
    const maxChars = e2eTestMode ? E2E_TEST_CHARS : (opts.maxWords === 50 ? MAX_CHARS_LONG : MAX_CHARS);

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: `You are a viral marketing copywriter for short-form videos (YouTube Shorts, Instagram Reels, TikTok).

STRICT RULES:
- Maximum ${e2eTestMode ? "15" : String(maxWords)} words total
- Maximum ${e2eTestMode ? "100" : String(maxChars)} characters total
- Structure: Hook (attention grabber) → Problem → Solution → CTA (call to action)
- Punchy, urgent, conversational. No stage directions or labels.
- Example: "Stop damaging your skin with chemicals. This herbal formula restores natural glow in just days. Try it before it sells out."

Output ONLY the script text, nothing else.`,
                },
                {
                    role: "user",
                    content: `Write a ${maxWords === 50 ? "~20 second" : "15-second"} marketing script for: "${topic}"`,
                },
            ],
            max_tokens: 150,
            temperature: 0.8,
        });

        let script = completion.choices[0].message.content.trim();
        if (!script) throw new Error("OpenAI returned an empty script");

        // Enforce limits (truncate if over)
        const words = script.split(/\s+/);
        if (words.length > maxWords) {
            script = words.slice(0, maxWords).join(" ");
        }
        if (script.length > maxChars) {
            script = script.slice(0, maxChars).trim();
        }

        // Extract hook (first sentence or first 5 words) for overlay
        const firstSentence = script.split(/[.!?]/)[0]?.trim() || script;
        const hook = firstSentence.length > 40
            ? firstSentence.split(/\s+/).slice(0, 5).join(" ") + "..."
            : firstSentence;

        logger.info("ScriptGenerator", `Script: ${script.split(/\s+/).length} words, ${script.length} chars`);
        return { script, hook: hook.toUpperCase() };
    } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        logger.error("ScriptGenerator", "OpenAI API error", err);
        throw new Error(`Script generation failed: ${msg}`);
    }
}

module.exports = { generateScript };
