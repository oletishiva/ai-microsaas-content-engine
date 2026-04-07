/**
 * affirmation_video_gen.js
 * ─────────────────────────────────────────────────────────────────
 * Cinematic affirmation / positive-vibes video — English + Telugu
 *
 * Visual style: full-bleed atmospheric background (DALL-E) +
 * dark gradient overlay + large centered quote text.
 * Much richer than the notebook aesthetic.
 *
 * Pipeline:
 *   1. Claude → affirmation text (quote + subtext)
 *   2. Claude → DALL-E image prompt tuned for language + type
 *   3. DALL-E 3 → cinematic background image (1024×1792)
 *   4. Sharp → text overlay (category label + quote + branding)
 *   5. FFmpeg → 15s video with smooth pan + fade + music
 */

require("dotenv").config();
const Anthropic    = require("@anthropic-ai/sdk");
const OpenAI       = require("openai");
const sharp        = require("sharp");
const fs           = require("fs");
const path         = require("path");
const https        = require("https");
const http         = require("http");
const { execSync } = require("child_process");

const W = 1080, H = 1920;

// ── Type definitions ──────────────────────────────────────────────────────────
const TYPES = {
    morning:   { en: "Morning Affirmation",  te: "ఉదయ స్ఫూర్తి",  icon: "🌅" },
    positive:  { en: "Positive Vibes",       te: "సానుకూల శక్తి", icon: "✨" },
    gratitude: { en: "Gratitude",            te: "కృతజ్ఞత",        icon: "🙏" },
    selflove:  { en: "Self Love",            te: "స్వ ప్రేమ",      icon: "💚" },
    success:   { en: "Success",              te: "విజయ స్ఫూర్తి", icon: "🏆" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function pickMusic() {
    const dir   = path.resolve(__dirname, "music");
    const files = fs.readdirSync(dir).filter(f => /\.(mp3|m4a|wav)$/i.test(f));
    if (!files.length) throw new Error("No music files in music/");
    return path.join(dir, files[Math.floor(Math.random() * files.length)]);
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const get  = url.startsWith("https") ? https.get : http.get;
        get(url, (res) => {
            if ([301, 302].includes(res.statusCode))
                return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            if (res.statusCode !== 200)
                return reject(new Error(`HTTP ${res.statusCode} downloading image`));
            res.pipe(file);
            file.on("finish", () => { file.close(); resolve(); });
        }).on("error", reject);
    });
}

function escapeXml(s) {
    return String(s || "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD]/g, "");
}

function wrapText(text, maxChars) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = "";
    for (const w of words) {
        const candidate = cur ? `${cur} ${w}` : w;
        if (candidate.length > maxChars && cur) { lines.push(cur); cur = w; }
        else cur = candidate;
    }
    if (cur) lines.push(cur);
    return lines;
}

// ── Step 1: Claude → affirmation quote ───────────────────────────────────────
async function generateQuote(language, type, custom) {
    if (custom && custom.trim()) return { quote: custom.trim(), subtext: "" };

    const client    = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    const isTelugu  = language === "telugu";
    const typeLabel = TYPES[type]?.[isTelugu ? "te" : "en"] || type;

    const response = await client.messages.create({
        model:      "claude-sonnet-4-6",
        max_tokens: 200,
        system: isTelugu
            ? `You write powerful modern Telugu affirmations. Return ONLY valid JSON:
{"quote": "affirmation in Telugu script (10–14 words, present tense)", "subtext": "4-word supporting thought in Telugu"}
Rules: Telugu script only, positive present tense (నేను/నాకు/నాలో), emotionally warm, modern not archaic.`
            : `You write powerful modern English affirmations. Return ONLY valid JSON:
{"quote": "affirmation (10–14 words, positive present tense)", "subtext": "4-word supporting thought"}
Rules: positive present tense (I am / I have / I attract / I choose), uplifting, concise.`,
        messages: [{ role: "user", content: `Type: ${typeLabel}. Generate a fresh, unique affirmation.` }],
    });

    const raw = response.content[0].text.trim()
        .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    return JSON.parse(raw);
}

// ── Step 2: Claude → cinematic DALL-E background prompt ──────────────────────
async function generateBgPrompt(language, type, quote) {
    const client   = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    const isTelugu = language === "telugu";

    const response = await client.messages.create({
        model:      "claude-sonnet-4-6",
        max_tokens: 300,
        system: `You craft DALL-E 3 prompts for stunning affirmation backgrounds.
The image must be:
- 9:16 portrait orientation, full-bleed
- Cinematic, atmospheric, emotionally resonant — makes the viewer feel the affirmation
- ${isTelugu
    ? "South Indian / Telugu cultural setting — lotus ponds, ancient temples, paddy fields, coconut palms, marigold festivals, oil lamps (deepam), golden sunsets over Godavari river"
    : "Universal nature — golden mountain peaks, misty forests, ocean at sunrise, aurora borealis, cosmos, cherry blossoms, sunflower fields"}
- Rich warm palette: golden, saffron, pink, violet, deep indigo, or emerald
- NO people, NO text, NO borders, NO frames
- Photorealistic OR painterly — both beautiful
Return ONLY the prompt string, nothing else.`,
        messages: [{ role: "user", content: `Type: ${type} | Quote: "${quote}"` }],
    });

    return response.content[0].text.trim();
}

// ── Step 3: DALL-E 3 → background image ──────────────────────────────────────
async function generateImage(prompt, imagePath) {
    const openai   = new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.images.generate({
        model: "dall-e-3", prompt, n: 1,
        size: "1024x1792", quality: "hd",
    });
    await downloadFile(response.data[0].url, imagePath);
}

// ── Step 4: Sharp — cinematic text overlay ────────────────────────────────────
async function compositeFrame(imagePath, quote, subtext, language, type, outputPath) {
    const isTelugu  = language === "telugu";
    const FONT_PATH = path.resolve(__dirname, "fonts", isTelugu ? "NotoSansTelugu.ttf" : "Caveat-Bold.ttf");
    const TEXT_W    = W - 100;
    const typeInfo  = TYPES[type] || TYPES.positive;
    const catLabel  = `${typeInfo.icon}  ${isTelugu ? typeInfo.te : typeInfo.en}`;

    const base = await sharp(imagePath)
        .resize(W, H, { fit: "cover", position: "center" })
        .flatten({ background: "#000000" })
        .toBuffer();

    async function rt(text, sizePt, color, weight) {
        const family = isTelugu ? "Noto Sans Telugu" : "Caveat";
        const markup = `<span font_family="${family}" font_size="${sizePt}pt" font_weight="${weight}" foreground="${color}">${escapeXml(text)}</span>`;
        const buf    = await sharp({ text: { text: markup, fontfile: FONT_PATH, width: TEXT_W, rgba: true, dpi: 96, align: "centre" } }).png().toBuffer();
        const { width: w, height: h } = await sharp(buf).metadata();
        return { buf, w: w || TEXT_W, h: h || 0 };
    }

    const composites = [];

    // ── TOP gradient — category label ─────────────────────────────────────────
    const topH   = 190;
    const topSvg = `<svg width="${W}" height="${topH}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#000" stop-opacity="0.80"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0"/>
      </linearGradient></defs>
      <rect width="${W}" height="${topH}" fill="url(#tg)"/>
    </svg>`;
    composites.push({ input: await sharp(Buffer.from(topSvg)).png().toBuffer(), top: 0, left: 0 });

    const { buf: catBuf, w: catW } = await rt(catLabel, 26, "#FCD34D", "bold");
    composites.push({ input: catBuf, top: 52, left: Math.floor((W - catW) / 2) });

    // ── BOTTOM gradient — quote text area ─────────────────────────────────────
    const botH   = Math.floor(H * 0.58);
    const botSvg = `<svg width="${W}" height="${botH}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#000" stop-opacity="0"/>
        <stop offset="30%"  stop-color="#000" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0.90"/>
      </linearGradient></defs>
      <rect width="${W}" height="${botH}" fill="url(#bg)"/>
    </svg>`;
    composites.push({ input: await sharp(Buffer.from(botSvg)).png().toBuffer(), top: H - botH, left: 0 });

    // ── Quote text — large, centered, starting from mid-gradient ─────────────
    const maxChars = isTelugu ? 14 : 20;
    const fontSize = isTelugu ? 50 : 68; // Caveat renders large — boost English
    const lines    = wrapText(quote, maxChars);
    let   textY    = H - botH + Math.floor(botH * 0.22);

    for (const line of lines) {
        const { buf, w: tw, h: th } = await rt(line, fontSize, "#FFFFFF", "900");
        composites.push({ input: buf, top: textY, left: Math.floor((W - tw) / 2) });
        textY += th + 12;
    }

    // Thin gold divider
    if (subtext) {
        textY += 20;
        const lineW   = 120;
        const lineBuf = await sharp({ create: { width: lineW, height: 2, channels: 4, background: { r: 252, g: 211, b: 77, alpha: 0.6 } } }).png().toBuffer();
        composites.push({ input: lineBuf, top: textY, left: Math.floor((W - lineW) / 2) });
        textY += 18;

        const { buf: subBuf, w: subW } = await rt(subtext, isTelugu ? 30 : 34, "#C8C8C8", "normal");
        composites.push({ input: subBuf, top: textY, left: Math.floor((W - subW) / 2) });
    }

    // Branding at bottom
    const brand     = isTelugu ? "✨ రోజువారీ స్ఫూర్తి" : "✨ Daily Affirmations";
    const { buf: brandBuf, w: brandW } = await rt(brand, 22, "#E8BF45", "bold");
    composites.push({ input: brandBuf, top: H - 55, left: Math.floor((W - brandW) / 2) });

    await sharp(base).composite(composites).jpeg({ quality: 92 }).toFile(outputPath);
    console.log(`   ✅ Frame composited`);
}

// ── Step 5: FFmpeg — smooth pan + fade ───────────────────────────────────────
function makeVideo(imagePath, videoPath) {
    const DURATION = 15;
    const SW       = Math.round(W * 1.08); // 8% scale-up for pan travel
    const SH       = Math.round(H * 1.08);
    const panX     = SW - W;
    const panY     = Math.floor((SH - H) / 2);

    // Slow left-to-right pan — smooth, no zoompan jitter
    const vf = [
        `scale=${SW}:${SH}`,
        `crop=${W}:${H}:'${panX}*(t/${DURATION})':${panY}`,
        `fade=t=in:st=0:d=1.0`,
        `fade=t=out:st=${DURATION - 1}:d=1.0`,
        `format=yuv420p`,
    ].join(",");

    const musicPath = pickMusic();
    const cmd = [
        "ffmpeg -y",
        `-loop 1 -framerate 30 -i "${imagePath}"`,
        `-i "${musicPath}"`,
        `-vf "${vf}"`,
        `-t ${DURATION}`,
        `-c:v libx264 -preset fast -profile:v baseline -level 3.1 -crf 23 -pix_fmt yuv420p -r 30 -threads 1`,
        `-c:a aac -b:a 128k -ar 44100 -ac 2 -shortest`,
        `-movflags +faststart`,
        `"${videoPath}"`,
    ].join(" ");

    execSync(cmd, { stdio: "pipe", timeout: 60000 });
    console.log(`   ✅ Video rendered: ${path.basename(videoPath)}`);
}

// ── Main exported function ────────────────────────────────────────────────────
async function generateAffirmationVideo({ language = "english", type = "positive", custom = "", outputDir = __dirname } = {}) {
    const ts       = Date.now();
    const imgPath  = path.join(outputDir, `aff_img_${ts}.png`);
    const compPath = path.join(outputDir, `aff_comp_${ts}.jpg`);
    const vidPath  = path.join(outputDir, `aff_video_${ts}.mp4`);

    console.log(`\n🌟 Affirmation — ${language} / ${type}`);

    // 1. Quote
    console.log("🔄 Step 1/4 — Generating affirmation quote...");
    const { quote, subtext } = await generateQuote(language, type, custom);
    console.log(`   ✅ "${quote}"`);

    // 2. Image prompt
    console.log("🔄 Step 2/4 — Building background prompt...");
    const bgPrompt = await generateBgPrompt(language, type, quote);
    console.log(`   ✅ Prompt ready`);

    // 3. Background image
    console.log("🔄 Step 3/4 — DALL-E generating background...");
    await generateImage(bgPrompt, imgPath);
    console.log(`   ✅ Background downloaded`);

    // 4. Composite + video
    console.log("🔄 Step 4/4 — Compositing + rendering video...");
    await compositeFrame(imgPath, quote, subtext, language, type, compPath);
    makeVideo(compPath, vidPath);

    // Keep compPath — caller uploads it to Cloudinary as the "quote image" for WhatsApp sharing
    return { videoPath: vidPath, imagePath: imgPath, compositeImagePath: compPath, quote, subtext, language, type };
}

module.exports = { generateAffirmationVideo, TYPES };
