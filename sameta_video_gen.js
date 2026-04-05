/**
 * sameta_video_gen.js
 * --------------------
 * Generates a Telugu Sameta (proverb) Short video.
 *
 * Layout (matches reference images):
 *   TOP  ~40% — cream/aged-paper background with:
 *               "సామెత" label (small, dark maroon)
 *               Large Sameta text (dark maroon)
 *               Meaning text (dark gray, smaller)
 *   BOTTOM ~60% — AI-generated watercolor scene image
 *
 * Usage:
 *   node sameta_video_gen.js                          → random Sameta
 *   node sameta_video_gen.js --random                 → random Sameta
 *   node sameta_video_gen.js "సామెత" "అర్థం"         → custom input
 *
 * Also exportable as a function for API/UI use:
 *   const { generateSametaVideo } = require('./sameta_video_gen');
 */

require("dotenv").config();
const Anthropic = require("@anthropic-ai/sdk");
const OpenAI    = require("openai");
const sharp     = require("sharp");
const fs        = require("fs");
const path      = require("path");
const https     = require("https");
const http      = require("http");
const { execSync } = require("child_process");

// ── Layout constants ──────────────────────────────────────────────────────────
const W = 1080, H = 1920;

// ── Used-sameta log — prevents repeats across runs ───────────────────────────
const USED_FILE = path.join(__dirname, "output", ".sameta_used.json");
function loadUsedSametas() {
    try { return JSON.parse(fs.readFileSync(USED_FILE, "utf8")); } catch (_) { return []; }
}
function saveUsedSameta(sameta) {
    const list = loadUsedSametas();
    list.push(sameta);
    try { fs.writeFileSync(USED_FILE, JSON.stringify(list.slice(-500)), "utf8"); } catch (_) {}
}

// Colors matching reference images
const MAROON = "#5C1A1A"; // "సామెత" label + Sameta text

// ── Built-in Telugu Sameta list for --random mode ─────────────────────────────
const SAMETA_LIST = [
    { sameta: "చేసిన మేలు మరువకు, చేసిన కీడు మరువు", meaning: "ఎవరైనా మనకు చేసిన మేలును ఎప్పుడూ గుర్తుపెట్టుకోవాలి, కానీ చేసిన చెడును మర్చిపోవాలి అని దీని అర్థం." },
    { sameta: "అన్నం పెట్టిన చేయి కొట్టకూడదు", meaning: "మనకు సహాయం చేసిన వారిని, మనల్ని పోషించిన వారిని ద్రోహం చేయకూడదు అని దీని అర్థం." },
    { sameta: "ఏటికి ఎదురీదితే గట్టెక్కవచ్చు", meaning: "కష్టాలకు ఎదురు నిలబడి పోరాడితే విజయం సాధించవచ్చు అని దీని భావం." },
    { sameta: "కాకికి తన పిల్లలు బంగారు పిల్లలు", meaning: "ప్రతి తల్లిదండ్రులకు తమ పిల్లలే అందరిలో గొప్పవారిగా కనిపిస్తారు అని దీని అర్థం." },
    { sameta: "ఇంటి దొంగను ఈశ్వరుడైనా పట్టుకోలేడు", meaning: "నమ్మకమైన వ్యక్తి చేసే మోసాన్ని పట్టుకోవడం చాలా కష్టం అని దీని అర్థం." },
    { sameta: "అతి విద్య సతి మాయ", meaning: "అతి చదువు కొన్నిసార్లు అహంకారానికి దారితీస్తుంది అని దీని భావం." },
    { sameta: "ఓడిన వాడే గెలిచేది నేర్చుకుంటాడు", meaning: "వైఫల్యాల నుండి పాఠాలు నేర్చుకున్న వారే నిజమైన విజయం సాధిస్తారు అని దీని అర్థం." },
    { sameta: "చెట్టు నాటిన వాడు పండు తినలేడు", meaning: "ఒకరు చేసిన కష్టాల ఫలాలు వారి తర్వాత తరాలు అనుభవిస్తాయి అని దీని అర్థం." },
    { sameta: "నీళ్ళు తాగి కాలు జాడించకూడదు", meaning: "ఉపకారం చేసిన వారిని మర్చిపోయి వారికి హాని చేయకూడదు అని దీని భావం." },
    { sameta: "ఆకలికి ఆమడ దూరం లేదు", meaning: "ఆకలి బాధ చాలా తీవ్రంగా ఉంటుంది, దానిని అన్ని అవరోధాలు దాటించగలదు అని దీని అర్థం." },
    { sameta: "దెయ్యాలు వేదాలు వల్లించినట్లు", meaning: "పరమ దుర్మార్గులు, చెడ్డవారు నీతులు చెబుతుంటే ఈ సామెత వాడతారు." },
    { sameta: "ఎంత వాడయినా కాంతా దాసుడే", meaning: "మనిషి బయట ఎంతటి శక్తివంతుడైనా, గొప్పవాడైనా సరే తన భార్య లేదా స్త్రీ ప్రేమకు లొంగిపోక తప్పడు." },
    { sameta: "ఎంత చెట్టుకు అంత గాలి", meaning: "చెట్టు ఎంత పెద్దగా ఉంటే, దానికి అంత ఎక్కువగా గాలి తాకుతుంది. మనిషి స్థాయి పెరిగే కొద్దీ బాధ్యతలు కూడా అదే స్థాయిలో పెరుగుతాయి." },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function pickMusic() {
    const dir = path.resolve(__dirname, "music");
    const files = fs.readdirSync(dir).filter(f => /\.(mp3|m4a|wav)$/i.test(f));
    if (files.length === 0) throw new Error("No audio files in music/ folder");
    return path.join(dir, files[Math.floor(Math.random() * files.length)]);
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const get = url.startsWith("https") ? https.get : http.get;
        get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302)
                return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            if (res.statusCode !== 200)
                return reject(new Error(`HTTP ${res.statusCode} downloading image`));
            res.pipe(file);
            file.on("finish", () => { file.close(); resolve(); });
        }).on("error", reject);
    });
}

function escapeXml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** Wrap Telugu text into lines of max N characters */
function wrapText(text, maxChars) {
    const words = text.split(" ");
    const lines = [];
    let current = "";
    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length > maxChars && current) {
            lines.push(current);
            current = word;
        } else {
            current = candidate;
        }
    }
    if (current) lines.push(current);
    return lines;
}

// ── Random Sameta: Claude picks from its vast knowledge, never repeating ──────
async function pickRandomSameta() {
    console.log("🎲 Asking Claude to pick a fresh Telugu Sameta...");

    // Build avoid list from last 80 used sametas
    const used = loadUsedSametas();
    const recent = used.slice(-80);
    const avoidSection = recent.length > 0
        ? `\n\nSTRICTLY AVOID — already used (do NOT repeat any of these):\n${recent.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
        : "";

    // Rotate through categories so content stays diverse
    const CATEGORIES = [
        "motivational / hardwork / perseverance",
        "wisdom / life lessons / experience",
        "karma / justice / what goes around",
        "family / relationships / love",
        "village life / farming / nature / seasons",
        "character / honesty / integrity",
        "money / wealth / greed",
        "friendship / trust / betrayal",
        "food / hunger / hospitality",
        "patience / timing / opportunity",
        "pride / ego / humility",
        "knowledge / education / foolishness",
    ];
    const category = CATEGORIES[used.length % CATEGORIES.length];

    const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        system: `You are an expert in Telugu literature and proverbs (సామెతలు) with knowledge of thousands of ancient and regional Telugu sayings.
Return ONLY valid JSON — no markdown, no explanation.
Format: {"sameta": "Telugu proverb here", "meaning": "Telugu meaning here"}
Rules:
- Both sameta and meaning MUST be in Telugu script
- Meaning: MAX 15 words — one punchy sentence, no long explanations
- Today's category: ${category} — pick a sameta fitting this theme
- Prefer lesser-known regional gems and vivid imagery over famous/overused ones${avoidSection}`,
        messages: [{ role: "user", content: "Give me one fresh Telugu Sameta from today's category that is NOT in the avoid list." }],
    });

    const raw = response.content[0].text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const json = JSON.parse(raw);

    // Record it so it won't be picked again
    saveUsedSameta(json.sameta);

    console.log(`✅ Sameta (${category}): ${json.sameta}`);
    return json;
}

// ── Step 1: Claude → DALL-E image prompt ─────────────────────────────────────
async function generateImagePrompt(sameta, meaning) {
    console.log("🔄 Step 1/3 — Claude generating image prompt...");
    const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: `You are a master DALL-E 3 prompt engineer specializing in Telugu cultural watercolor art.

Create a SINGLE unified portrait image (9:16) — absolutely NOT two panels, NOT split side by side, NOT divided vertically.

The image is ONE continuous scene top-to-bottom:

TOP 35% — Pristine aged parchment / cream paper texture. Completely empty — NO figures, NO objects, NO illustrations here. Just warm creamy paper (#FFF8F0) with very subtle natural grain. This space is reserved for text overlays.

BOTTOM 65% — An exquisitely detailed traditional Telugu watercolor illustration. CRITICAL COMPOSITION RULE: All human figures, animals, and main subjects MUST be fully visible and contained within the bottom 65% of the canvas. No figure should be cut off at the top — every character must show their full body, head to feet, within this lower portion. The characters should fill this space richly without being cropped. Follow these art style rules exactly:
- Style: authentic hand-painted South Indian watercolor, reminiscent of Raja Ravi Varma meets folk art
- Characters: traditional Andhra Pradesh villagers in authentic period clothing — men in dhotis/angavastrams, women in Pochampally sarees with jasmine in hair
- Setting: rich Telugu village environment — red-tiled thatched homes, neem/mango/banyan trees, paddy fields with water buffaloes, stone wells, earthen pots, oil lamps
- Lighting: warm golden hour sunlight, rich ochre/sienna/umber/sage tones, soft dramatic shadows
- Mood: emotionally resonant, story-illustrating, cinematic composition
- Detail level: highly detailed, museum-quality watercolor technique, visible brushstrokes, color bleeding at edges
- The scene must directly illustrate the proverb's story or moral — not abstract, but a specific narrative moment

TRANSITION: The cream paper area flows organically into the watercolor scene via a soft watercolor wash — no hard line, no border, no frame. The scene bleeds upward naturally like paint on wet paper.

CRITICAL: One single continuous image. No text. No borders. No panels. No split.
Return only the DALL-E 3 image prompt, nothing else.`,
        messages: [{
            role: "user",
            content: `Telugu proverb: "${sameta}"\nMeaning: "${meaning}"\n\nCreate a vivid, culturally authentic DALL-E 3 prompt for this proverb's scene.`,
        }],
    });
    const prompt = response.content[0].text.trim();
    console.log(`✅ Claude prompt: "${prompt.slice(0, 100)}..."`);
    return prompt;
}

// ── Step 2: DALL-E 3 → scene image ───────────────────────────────────────────
async function generateImage(prompt, imagePath) {
    console.log("🔄 Step 2/3 — DALL-E 3 generating image...");
    const openai = new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.images.generate({
        model:   "dall-e-3",
        prompt,
        n:       1,
        size:    "1024x1792",  // native 9:16 portrait — no crop needed
        quality: "hd",        // higher detail, richer watercolor; ~40s but worth it for cultural art
    });
    await downloadFile(response.data[0].url, imagePath);
    console.log(`✅ Image downloaded: ${path.basename(imagePath)}`);
}

// ── Step 3: Composite image — cream text area + scene + video ─────────────────
async function createVideo(imagePath, sameta, meaning, videoPath) {
    console.log("🔄 Step 3/3 — Compositing layout + rendering video...");

    const FONT_PATH = path.resolve(__dirname, "fonts", "NotoSansTelugu.ttf");
    const jpegCompositePath = imagePath.replace(/\.png$/, "_composite.jpg");

    // Push text down so YouTube/Instagram top UI chrome doesn't cover the title
    const TOP_OFFSET = Math.floor(H * 0.04); // 4% = 77px @ 1920
    const CREAM_H    = Math.floor(H * 0.45); // 45% = 864px — enough for text, more image visible
    const TEXT_W     = W - 120;              // 960px usable text width with padding

    // ── Resize + flatten base image ───────────────────────────────────────────
    const baseBuffer = await sharp(imagePath)
        .resize(W, H, { fit: "cover", position: "center" })
        .flatten({ background: "#FFFFFF" })
        .toBuffer();

    // ── Helper: render centered Pango text, returns composite descriptor ──────
    // sharp text images are auto-sized to text width (NOT fixed at `width`),
    // so we manually center by computing left = (W - rendered_width) / 2
    async function pangoText(text, fontSizePt, color, weight, topY) {
        const markup = `<span font_family="Noto Sans Telugu" font_size="${fontSizePt}pt" font_weight="${weight}" foreground="${color}">${escapeXml(text)}</span>`;
        const buf = await sharp({
            text: { text: markup, fontfile: FONT_PATH, width: TEXT_W, rgba: true, dpi: 96, align: "centre" },
        }).png().toBuffer();
        const { width: tw, height: th } = await sharp(buf).metadata();
        const left = Math.max(0, Math.floor((W - (tw || TEXT_W)) / 2));
        return { input: buf, top: topY, left, _h: th || 0 };
    }

    // ── Composites: cream background first, then text layers on top ──────────
    const composites = [];

    // Gradient cream overlay — fully opaque at top, fades to transparent at bottom
    // so the scene blends naturally instead of showing a hard edge (two-image look)
    const FADE_START = Math.floor(CREAM_H * 0.80); // solid until 80% of cream area, quick fade
    const gradientSvg = `<svg width="${W}" height="${CREAM_H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="#FEF5E4" stop-opacity="1"/>
          <stop offset="${Math.round(FADE_START / CREAM_H * 100)}%" stop-color="#FEF5E4" stop-opacity="1"/>
          <stop offset="100%" stop-color="#FEF5E4" stop-opacity="0"/>
        </linearGradient>
        <!-- Subtle paper grain via feTurbulence -->
        <filter id="grain" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" result="noise"/>
          <feColorMatrix type="saturate" values="0" in="noise" result="grayNoise"/>
          <feBlend in="SourceGraphic" in2="grayNoise" mode="multiply" result="blended"/>
          <feComposite in="blended" in2="SourceGraphic" operator="in"/>
        </filter>
      </defs>
      <!-- Base cream gradient -->
      <rect width="${W}" height="${CREAM_H}" fill="url(#cg)"/>
      <!-- Grain texture layer — very subtle, opacity 0.12 -->
      <rect width="${W}" height="${CREAM_H}" fill="url(#cg)" filter="url(#grain)" opacity="0.12"/>
      <!-- Subtle warm vignette at edges for aged-paper feel -->
      <rect width="${W}" height="${CREAM_H}" fill="none"
            stroke="#C8A882" stroke-width="0" opacity="0"/>
      <!-- Edge darkening — very faint -->
      <radialGradient id="vgn" cx="50%" cy="30%" r="70%">
        <stop offset="0%"   stop-color="#FEF5E4" stop-opacity="0"/>
        <stop offset="100%" stop-color="#C8A060" stop-opacity="0.08"/>
      </radialGradient>
      <rect width="${W}" height="${CREAM_H}" fill="url(#vgn)"/>
    </svg>`;
    const creamBuf = await sharp(Buffer.from(gradientSvg)).png().toBuffer();
    composites.push({ input: creamBuf, top: 0, left: 0 });

    // ── H1: "సామెత" — large, bold, centered maroon title ────────────────────
    const label = await pangoText("సామెత", 58, MAROON, "bold", 45 + TOP_OFFSET);
    composites.push(label);
    let y = label.top + label._h + 18;

    // Thin divider line
    const LINE_W = 220;
    const lineBuf = await sharp({
        create: { width: LINE_W, height: 4, channels: 4, background: { r: 92, g: 26, b: 26, alpha: 0.65 } },
    }).png().toBuffer();
    composites.push({ input: lineBuf, top: y, left: Math.floor((W - LINE_W) / 2) });
    y += 22;

    // ── H2: Proverb — very large, bold, near-black, centered ─────────────────
    for (const line of wrapText(sameta, 16)) {
        const el = await pangoText(line, 62, "#1C0A0A", "bold", y);
        composites.push(el);
        y += el._h + 6;
    }
    y += 22;

    // ── H3: Meaning — medium, regular, dark gray, centered ───────────────────
    // Truncate to max 2 lines (keeps text inside cream area, competitor style)
    const meaningTruncated = meaning.length > 80 ? meaning.slice(0, 78) + "..." : meaning;
    const meaningLines = wrapText(`భావం: ${meaningTruncated}`, 22);
    const maxLines = 3; // never overflow cream area
    for (let i = 0; i < Math.min(meaningLines.length, maxLines); i++) {
        const el = await pangoText(meaningLines[i], 34, "#2C1810", "normal", y);
        composites.push(el);
        y += el._h + 5;
    }

    // ── Composite all layers onto base image ──────────────────────────────────
    await sharp(baseBuffer)
        .composite(composites)
        .jpeg({ quality: 90 })
        .toFile(jpegCompositePath);

    // ── FFmpeg: image → 15s video + music + fade ────────────────────────────
    const musicPath = pickMusic();
    console.log(`   Music: ${path.basename(musicPath)}`);

    const DURATION = 15;
    const cmd = [
        "ffmpeg -y",
        `-loop 1 -framerate 30 -i "${jpegCompositePath}"`,
        `-i "${musicPath}"`,
        `-vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fade=t=in:st=0:d=1,fade=t=out:st=${DURATION - 1}:d=1"`,
        `-t ${DURATION}`,
        `-c:v libx264 -preset fast -profile:v baseline -level 3.1 -crf 23 -pix_fmt yuv420p -r 30 -threads 2`,
        `-c:a aac -b:a 128k -ar 44100 -ac 2 -shortest`,
        `-movflags +faststart`,
        `"${videoPath}"`,
    ].join(" ");

    execSync(cmd, { stdio: "pipe" });
    try { fs.unlinkSync(jpegCompositePath); } catch (_) {}

    console.log(`✅ Video created: ${videoPath}`);
}

// ── Main exported function (usable from API/UI) ───────────────────────────────
async function generateSametaVideo({ sameta, meaning, outputDir = __dirname } = {}) {
    const ts        = Date.now();
    const imagePath = path.join(outputDir, `sameta_image_${ts}.png`);
    const videoPath = path.join(outputDir, `sameta_output_${ts}.mp4`);

    const imagePrompt = await generateImagePrompt(sameta, meaning);
    await generateImage(imagePrompt, imagePath);
    await createVideo(imagePath, sameta, meaning, videoPath);

    // Return both paths — caller decides whether to upload/keep the image
    return { videoPath, imagePath };
}

// ── CLI entry point ───────────────────────────────────────────────────────────
if (require.main === module) {
    (async () => {
        const args = process.argv.slice(2);

        let sameta, meaning;

        if (args[0] === "--random" || args.length === 0) {
            // Claude picks a random Sameta from its knowledge of 1000s
            const pick = await pickRandomSameta();
            sameta  = pick.sameta;
            meaning = pick.meaning;
        } else if (args.length >= 2) {
            sameta  = args[0];
            meaning = args[1];
            console.log("✏️  Custom input mode");
        } else {
            console.error("Usage:\n  node sameta_video_gen.js                  (random)\n  node sameta_video_gen.js \"సామెత\" \"అర్థం\"  (custom)");
            process.exit(1);
        }

        console.log("\n═══════════════════════════════════════");
        console.log("  SAMETA VIDEO GENERATOR");
        console.log("═══════════════════════════════════════");
        console.log(`  Sameta : ${sameta}`);
        console.log(`  Meaning: ${meaning}`);
        console.log("═══════════════════════════════════════\n");

        const ts        = Date.now();
        const imagePath = path.resolve(__dirname, `sameta_image.png`);
        const videoPath = path.resolve(__dirname, `sameta_output_${ts}.mp4`);

        try {
            // Reuse existing image if present (saves API tokens on re-runs)
            if (fs.existsSync(imagePath)) {
                console.log("⏩ Existing image found — skipping Steps 1 & 2");
                console.log("   (Delete sameta_image.png to regenerate)\n");
            } else {
                const prompt = await generateImagePrompt(sameta, meaning);
                await generateImage(prompt, imagePath);
            }

            await createVideo(imagePath, sameta, meaning, videoPath);

            console.log("\n═══════════════════════════════════════");
            console.log("  ✅ ALL DONE!");
            console.log(`  Video: ${videoPath}`);
            console.log("═══════════════════════════════════════\n");
        } catch (err) {
            console.error("\n❌ FAILED:", err.message);
            process.exit(1);
        }
    })();
}

module.exports = { generateSametaVideo, pickRandomSameta, SAMETA_LIST };
