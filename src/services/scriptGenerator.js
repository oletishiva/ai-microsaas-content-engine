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

const openai = new OpenAI({ apiKey: OPENAI_API_KEY, timeout: 30_000 }); // 30s hard timeout

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

Return FIVE parts in this exact format:

HOOK: [3–5 words ALL CAPS — the very first thing viewers see. Must stop the scroll instantly. e.g. "YOUR LIFE STARTS NOW", "STOP WASTING YOUR TIME", "THIS CHANGES EVERYTHING", "NOBODY TELLS YOU THIS"]

SCRIPT: [35 words max – full narration for voice]

QUOTE: [45 words max – wisdom for on-screen. Single paragraph only.]

HIGHLIGHT: [1–2 key phrases from the quote, separated by | – these get yellow highlight]

TITLE: [Copy the single most powerful sentence from QUOTE word-for-word. Add ONE emotion emoji at the end. Under 60 chars total. e.g. "Your silence speaks louder than your words 🔥", "Stop letting people rent space in your head 💭", "One day you'll look back and be grateful 🙏"]

RULES:
- HOOK: 3–5 words ALL CAPS, no punctuation, no ellipsis. Must stop the scroll.
- QUOTE: emotional, memorable wisdom. NOT advertising. Single paragraph.
- HIGHLIGHT: 1–2 powerful phrases from QUOTE (exact match for yellow highlight).
- TITLE: must be the actual quote sentence — this is what people search and click on.
  Use second-person "you/your" or universal truths. One emoji. Under 60 chars.
- Output ONLY HOOK:, SCRIPT:, QUOTE:, HIGHLIGHT:, and TITLE: lines.`;

    try {
        // Retry up to 3 times – Railway shared IPs often timeout on first attempt
        // but succeed on retry (hits a different routing path to OpenAI).
        let completion;
        const MAX_RETRIES = 3;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                logger.info("ScriptGenerator", `OpenAI call attempt ${attempt}/${MAX_RETRIES}...`);
                completion = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        { role: "system", content: systemPrompt },
                        {
                            role: "user",
                            content: `Topic: "${topic}". Write SCRIPT (voice), QUOTE (on-screen, up to 45 words), and HIGHLIGHT (1–2 phrases from quote, separated by |).`,
                        },
                    ],
                    max_tokens: 400,
                    temperature: 0.7,
                });
                break; // success – exit retry loop
            } catch (retryErr) {
                const isLast = attempt === MAX_RETRIES;
                logger.warn("ScriptGenerator", `Attempt ${attempt} failed: ${retryErr.message}${isLast ? " – giving up" : " – retrying in 2s"}`);
                if (isLast) throw retryErr;
                await new Promise((r) => setTimeout(r, 2000));
            }
        }

        const raw = completion.choices[0].message.content.trim();
        if (!raw) throw new Error("OpenAI returned an empty script");

        let hook = "";
        let script = "";
        let quote = "";
        let highlight = [];
        let title = "";

        const hookMatch    = raw.match(/HOOK:\s*([\s\S]+?)(?=SCRIPT:|QUOTE:|HIGHLIGHT:|TITLE:|$)/i);
        const scriptMatch  = raw.match(/SCRIPT:\s*([\s\S]+?)(?=HOOK:|QUOTE:|HIGHLIGHT:|TITLE:|$)/i);
        const quoteMatch   = raw.match(/QUOTE:\s*([\s\S]+?)(?=HOOK:|HIGHLIGHT:|TITLE:|SCRIPT:|$)/i);
        const highlightMatch = raw.match(/HIGHLIGHT:\s*([\s\S]+?)(?=HOOK:|TITLE:|SCRIPT:|QUOTE:|$)/i);
        const titleMatch   = raw.match(/TITLE:\s*([\s\S]+?)(?=HOOK:|SCRIPT:|QUOTE:|HIGHLIGHT:|$)/i);

        if (hookMatch)   hook = hookMatch[1].trim().replace(/[.!?,]+$/, "").toUpperCase();
        if (scriptMatch) script = scriptMatch[1].trim();
        if (quoteMatch)  quote = quoteMatch[1].trim();
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

        // Fallback: if OpenAI didn't return a HOOK, derive one from the first sentence (3 words max, no ellipsis)
        if (!hook) {
            const firstSentence = script.split(/[.!?]/)[0]?.trim() || script;
            hook = firstSentence.split(/\s+/).slice(0, 5).join(" ").toUpperCase();
        }

        logger.info("ScriptGenerator", `Hook: "${hook}" | Script: ${script.split(/\s+/).length} words | Quote: ${quote.split(/\s+/).length} words`);
        return { script, hook, quote, highlight, title };
    } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        logger.error("ScriptGenerator", "OpenAI API error", err);
        throw new Error(`Script generation failed: ${msg}`);
    }
}

module.exports = { generateScript };
