/**
 * src/services/scriptGenerator.js
 * ---------------------------------
 * STEP 1: Generate short-form quote-style scripts for Shorts/Reels.
 * One-click post: topic → beautiful quote (not advertising).
 * Returns script (voice) + quote (on-screen overlay, short single paragraph).
 */

const OpenAI = require("openai");
const { OPENAI_API_KEY } = require("../../config/apiKeys");
const logger = require("../../utils/logger");

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const MAX_WORDS = 35;
const MAX_CHARS = 200;
const MAX_WORDS_LONG = 50;
const MAX_CHARS_LONG = 280;
const E2E_TEST_WORDS = 15;
const E2E_TEST_CHARS = 100;
/** On-screen quote: up to ~45 words (reference style) */
const QUOTE_MAX_WORDS = 45;
const QUOTE_MAX_CHARS = 280;

/**
 * generateScript
 * @param {string} topic - Topic (e.g. "daily motivation", "life rules")
 * @param {boolean} e2eTestMode - If true, use shorter limits
 * @param {Object} [opts] - { maxWords: number }
 * @returns {Promise<{ script: string, hook: string, quote: string }>} - script for voice, quote for overlay
 */
async function generateScript(topic, e2eTestMode = false, opts = {}) {
    if (!OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not set in .env");
    }
    logger.info("ScriptGenerator", `Generating quote for topic: "${topic}"`);

    const maxWords = e2eTestMode ? E2E_TEST_WORDS : (opts.maxWords ?? MAX_WORDS);
    const maxChars = e2eTestMode ? E2E_TEST_CHARS : (opts.maxWords === 50 ? MAX_CHARS_LONG : MAX_CHARS);

    const systemPrompt = `You create viral motivational quotes for short-form videos (YouTube Shorts, Reels, TikTok).

Return FOUR parts in this exact format:

SCRIPT: [35 words max – full narration for voice]

QUOTE: [45 words max – wisdom for on-screen. Single paragraph only.]

HIGHLIGHT: [1–2 key phrases from the quote, separated by | – these get yellow highlight]

TITLE: [5–8 word punchy phrase for YouTube title, e.g. "Don't let them weigh you down"]

RULES:
- QUOTE must be emotional, memorable wisdom. NOT advertising.
- HIGHLIGHT: choose 1–2 powerful phrases that appear in the QUOTE (exact match).
- TITLE: catchy phrase from the quote, like viral Shorts titles.
- Output ONLY SCRIPT:, QUOTE:, HIGHLIGHT:, and TITLE: lines.`;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: `Topic: "${topic}". Write SCRIPT (voice), QUOTE (on-screen, up to 45 words), and HIGHLIGHT (1–2 phrases from quote, separated by |).`,
                },
            ],
            max_tokens: 200,
            temperature: 0.7,
        });

        const raw = completion.choices[0].message.content.trim();
        if (!raw) throw new Error("OpenAI returned an empty script");

        let script = "";
        let quote = "";
        let highlight = [];
        let title = "";

        const scriptMatch = raw.match(/SCRIPT:\s*([\s\S]+?)(?=QUOTE:|HIGHLIGHT:|TITLE:|$)/i);
        const quoteMatch = raw.match(/QUOTE:\s*([\s\S]+?)(?=HIGHLIGHT:|TITLE:|SCRIPT:|$)/i);
        const highlightMatch = raw.match(/HIGHLIGHT:\s*([\s\S]+?)(?=TITLE:|SCRIPT:|QUOTE:|$)/i);
        const titleMatch = raw.match(/TITLE:\s*([\s\S]+?)(?=SCRIPT:|QUOTE:|HIGHLIGHT:|$)/i);
        if (scriptMatch) script = scriptMatch[1].trim();
        if (quoteMatch) quote = quoteMatch[1].trim();
        if (highlightMatch) {
            highlight = highlightMatch[1].split(/\|/).map((s) => s.trim()).filter(Boolean);
        }
        if (titleMatch) title = titleMatch[1].trim().slice(0, 80);

        if (!script) script = raw.replace(/QUOTE:[\s\S]+/i, "").replace(/SCRIPT:\s*/i, "").trim() || raw;
        if (!quote || quote === script) {
            const sentences = script.split(/[.!?]+/).filter(Boolean);
            quote = sentences.length ? (sentences.slice(0, 2).join(". ").trim() + ".").slice(0, QUOTE_MAX_CHARS) : script;
        }
        if (!title) {
            const lastSentence = quote.split(/[.!?]+/).filter(Boolean).pop() || quote;
            title = lastSentence.split(/\s+/).slice(0, 8).join(" ");
        }

        // Enforce script limits
        const scriptWords = script.split(/\s+/);
        if (scriptWords.length > maxWords) script = scriptWords.slice(0, maxWords).join(" ");
        if (script.length > maxChars) script = script.slice(0, maxChars).trim();

        // Enforce quote limits – short, single paragraph, no truncation
        const quoteWords = quote.split(/\s+/);
        if (quoteWords.length > QUOTE_MAX_WORDS) quote = quoteWords.slice(0, QUOTE_MAX_WORDS).join(" ");
        if (quote.length > QUOTE_MAX_CHARS) quote = quote.slice(0, QUOTE_MAX_CHARS).trim();

        const firstSentence = script.split(/[.!?]/)[0]?.trim() || script;
        const hookWords = firstSentence.split(/\s+/).filter(Boolean);
        const hook = firstSentence.length > 25
            ? hookWords.slice(0, 4).join(" ") + (hookWords.length > 4 ? "..." : "")
            : firstSentence;

        logger.info("ScriptGenerator", `Script: ${script.split(/\s+/).length} words, quote: ${quote.split(/\s+/).length} words, highlight: [${highlight.join(", ")}]`);
        return { script, hook: hook.toUpperCase(), quote, highlight, title };
    } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        logger.error("ScriptGenerator", "OpenAI API error", err);
        throw new Error(`Script generation failed: ${msg}`);
    }
}

module.exports = { generateScript };
