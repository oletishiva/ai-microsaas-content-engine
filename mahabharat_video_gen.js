/**
 * mahabharat_video_gen.js
 * ────────────────────────
 * Generates a 30-second Telugu Mahabharat Short video.
 *
 * Layout (cinematic style — NOT folk/watercolor):
 *   Full frame: dramatic Mahabharat scene (DALL-E 3 epic illustration)
 *   TOP overlay: dark gradient → EP badge + character name
 *   BOTTOM overlay: dark gradient → episode title (large)
 *
 * Pipeline:
 *   1. Claude → DALL-E 3 image prompt (epic Mahabharat scene)
 *   2. DALL-E 3 → 1080×1920 cinematic scene image
 *   3. sharp → composite text overlays (EP, character, title, hook)
 *   4. ElevenLabs → voice narration (hook + story + lesson + cta)
 *   5. FFmpeg → 30s video + music + voice + fade
 *   6. Upload to Cloudinary + YouTube
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
const GOLD   = "#C9A84C";
const WHITE  = "#FFFFFF";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pickMusic() {
    const dir   = path.resolve(__dirname, "music");
    const files = fs.readdirSync(dir).filter(f => /\.(mp3|m4a|wav)$/i.test(f));
    if (files.length === 0) throw new Error("No audio files in music/ folder");
    return path.join(dir, files[Math.floor(Math.random() * files.length)]);
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const get  = url.startsWith("https") ? https.get : http.get;
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
    return String(str || "")
        // Replace chars Pango's XML parser rejects
        .replace(/—/g, "-")          // em dash
        .replace(/–/g, "-")          // en dash
        .replace(/•/g, "·")          // bullet → middle dot
        .replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD]/g, "") // strip non-XML chars
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ── Step 1: Claude → DALL-E image prompt ─────────────────────────────────────
async function generateImagePrompt(script) {
    console.log("🔄 Step 1/4 — Claude generating cinematic image prompt...");
    const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
        model:      "claude-sonnet-4-6",
        max_tokens: 500,
        system: `You are a master DALL-E 3 prompt engineer for Indian mythological illustration.

Create a SINGLE portrait image (9:16) — ONE continuous cinematic frame from the ancient Indian epic Mahabharata.

Image structure top-to-bottom:
- Top 20%: naturally dark sky or shadow gradient — for text overlay
- Middle 60%: the vivid dramatic scene — the emotional focal moment
- Bottom 20%: naturally dark ground or shadow gradient — for title overlay

Art style:
- Premium Indian mythological illustration — Amar Chitra Katha meets cinematic concept art
- Dramatic volumetric lighting — golden god-rays, warm amber and saffron tones
- Rich palette: deep saffron, royal blue, golden yellow, warm crimson
- Characters in authentic ancient Indian royal attire — ornate crowns, jewelry, silk garments
- Emotionally intense, dignified composition — focus on character expression and posture
- NO text, NO borders, NO panels, NOT watercolor, NOT folk art

CRITICAL — to pass content filters:
- Describe scenes as ILLUSTRATIONS of ancient mythology, not photographs
- Focus on CHARACTER EMOTION and DRAMATIC LIGHTING, not physical conflict
- Use words like "stands before", "gazes upon", "raises hand", "moment of realization"
- Avoid: "battle", "fight", "war", "weapon", "sword", "blood", "death", "kill", "attack"
- Instead use: "confrontation", "dramatic moment", "heroic stance", "divine intervention"

Return ONLY the DALL-E 3 prompt, nothing else.`,
        messages: [{
            role:    "user",
            content: `Ancient Indian epic scene: "${script.incident || script.title}"
Character: ${script.character}
Emotional moment: "${script.hook}"
Create a safe, content-filter-friendly DALL-E 3 prompt for this mythological illustration.`,
        }],
    });
    const prompt = response.content[0].text.trim();
    console.log(`✅ Image prompt: "${prompt.slice(0, 80)}..."`);
    return prompt;
}

// ── Step 2: DALL-E 3 → scene image ───────────────────────────────────────────
async function generateImage(prompt, imagePath, character) {
    console.log("🔄 Step 2/4 — DALL-E 3 generating epic scene...");
    const openai = new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY });

    const tryGenerate = async (p) => {
        const response = await openai.images.generate({
            model:   "dall-e-3",
            prompt:  p,
            n:       1,
            size:    "1024x1792",
            quality: "hd",
        });
        return response.data[0].url;
    };

    let url;
    try {
        url = await tryGenerate(prompt);
    } catch (err) {
        if (err.status === 400 && err.message?.includes("safety")) {
            // Fallback: generic safe portrait prompt
            console.warn("   DALL-E safety rejection — retrying with safe fallback prompt...");
            const fallback = `Premium Indian mythological illustration, portrait 9:16. ` +
                `${character || "An ancient Indian sage"} in ornate royal attire, ` +
                `standing in a golden-lit palace courtyard at dusk. ` +
                `Dramatic volumetric lighting, deep saffron sky, ` +
                `Amar Chitra Katha meets cinematic concept art style. ` +
                `No text, no borders, highly detailed, emotionally intense.`;
            url = await tryGenerate(fallback);
        } else {
            throw err;
        }
    }

    await downloadFile(url, imagePath);
    console.log(`✅ Image downloaded: ${path.basename(imagePath)}`);
}

// ── Step 3: Composite text frames + stitch into 30s video ────────────────────
// Layout: 4 frames with progressive text reveal (no TTS, music only)
//   Frame 1 (5s)  — Hook:   stop-scroll line, large bold
//   Frame 2 (10s) — Story:  condensed 2-line incident
//   Frame 3 (10s) — Lesson: modern parallel in gold
//   Frame 4 (5s)  — CTA:    subscribe prompt
// Each frame: full DALL-E image + dark pill behind text (readable on any bg)
async function compositeVideo(imagePath, script, epNumber, videoPath) {
    console.log("🔄 Step 3/4 — Building text frames + rendering video...");

    const FONT_PATH = path.resolve(__dirname, "fonts", "NotoSansTelugu.ttf");
    const dir       = path.dirname(videoPath);
    const ts        = Date.now();

    // Base image resized once, reused for all 4 frames
    const baseBuffer = await sharp(imagePath)
        .resize(W, H, { fit: "cover", position: "center" })
        .flatten({ background: "#000000" })
        .toBuffer();

    // ── Helpers ───────────────────────────────────────────────────────────────

    // Render Pango markup → PNG buffer + dimensions
    async function renderText(text, sizePt, color, weight, maxW) {
        const w      = maxW || W - 100;
        const markup = `<span font_family="Noto Sans Telugu" font_size="${sizePt}pt" font_weight="${weight}" foreground="${color}">${escapeXml(text)}</span>`;
        const buf    = await sharp({ text: { text: markup, fontfile: FONT_PATH, width: w, rgba: true, dpi: 96, align: "centre" } }).png().toBuffer();
        const { width: rw, height: rh } = await sharp(buf).metadata();
        return { buf, w: rw || w, h: rh || 0 };
    }

    // Dark rounded pill behind text — keeps text readable on any image
    async function pillBuf(pillW, pillH) {
        const svg = `<svg width="${pillW}" height="${pillH}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${pillW}" height="${pillH}" rx="22" fill="#0D0D0F" fill-opacity="0.82"/>
        </svg>`;
        return sharp(Buffer.from(svg)).png().toBuffer();
    }

    // Build pill + text composites, vertically anchored at anchorY (center of pill)
    async function textPill(text, sizePt, color, weight, anchorY) {
        const padX = 52, padY = 24;
        const { buf, w: tw, h: th } = await renderText(text, sizePt, color, weight);
        const pW    = Math.min(tw + padX * 2, W - 60);
        const pH    = th + padY * 2;
        const pLeft = Math.floor((W - pW) / 2);
        const pTop  = Math.max(10, anchorY - Math.floor(pH / 2));
        return {
            items:  [
                { input: await pillBuf(pW, pH), top: pTop, left: pLeft },
                { input: buf, top: pTop + padY, left: pLeft + padX },
            ],
            bottom: pTop + pH,
        };
    }

    // Small gold-bordered label pill (e.g. "📖 కథ")
    async function labelPill(text, anchorY) {
        const padX = 32, padY = 14;
        const { buf, w: tw, h: th } = await renderText(text, 22, GOLD, "bold", W - 140);
        const pW    = Math.min(tw + padX * 2, W - 100);
        const pH    = th + padY * 2;
        const pLeft = Math.floor((W - pW) / 2);
        const pTop  = Math.max(10, anchorY - Math.floor(pH / 2));
        const svg   = `<svg width="${pW}" height="${pH}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${pW}" height="${pH}" rx="14" fill="#0D0D0F" fill-opacity="0.88"/>
          <rect x="1" y="1" width="${pW - 2}" height="${pH - 2}" rx="13" fill="none" stroke="#C9A84C" stroke-width="1.5"/>
        </svg>`;
        return {
            items:  [
                { input: await sharp(Buffer.from(svg)).png().toBuffer(), top: pTop, left: pLeft },
                { input: buf, top: pTop + padY, left: pLeft + padX },
            ],
            bottom: pTop + pH,
        };
    }

    // Trim to N words for screen readability
    function trim(text, maxWords) {
        const words = (text || "").split(/\s+/);
        return words.length <= maxWords ? text : words.slice(0, maxWords).join(" ") + "...";
    }

    // ── Persistent elements (appear on every frame) ───────────────────────────

    // EP pill badge — top-left
    const epSvg = `<svg width="112" height="42" xmlns="http://www.w3.org/2000/svg">
      <rect width="112" height="42" rx="10" fill="#0D0D0F" fill-opacity="0.85"/>
      <rect x="1" y="1" width="110" height="40" rx="9" fill="none" stroke="#C9A84C" stroke-width="1.5"/>
    </svg>`;
    const { buf: epTxtBuf } = await renderText(`EP ${String(epNumber).padStart(2, "0")}`, 20, GOLD, "bold", 100);
    const EP_BADGE = [
        { input: await sharp(Buffer.from(epSvg)).png().toBuffer(), top: 36, left: 40 },
        { input: epTxtBuf, top: 47, left: 47 },
    ];

    // Character · Category — small centered text just below EP badge area
    const { buf: charBuf } = await renderText(
        `${script.character}  ·  ${script.category}`, 20, "#CCCCCC", "normal"
    );
    const CHAR_LINE = [{ input: charBuf, top: 96, left: Math.floor((W - (W - 100)) / 2) }];

    // ── Text content ──────────────────────────────────────────────────────────
    const hookText   = script.hook  || "";
    const storyText  = trim(script.story  || "", 22);
    const lessonText = trim(script.lesson || "", 18);
    const ctaText    = script.cta   || "";

    // Anchor text pills at Y=1480 (lower-center, comfortable reading area)
    const TEXT_Y      = 1480;
    const LABEL_Y     = TEXT_Y - 110;

    // ── Build each frame ──────────────────────────────────────────────────────
    async function buildFrame(items) {
        return sharp(baseBuffer)
            .composite([...EP_BADGE, ...CHAR_LINE, ...items])
            .jpeg({ quality: 92 })
            .toBuffer();
    }

    const hook1   = await textPill(hookText,   46, WHITE, "bold",   TEXT_Y);
    const story1  = await labelPill("📖 కథ",                        LABEL_Y);
    const story2  = await textPill(storyText,  36, WHITE, "normal", TEXT_Y + 20);
    const lesson1 = await labelPill("💡 నేటి పాఠం",                 LABEL_Y);
    const lesson2 = await textPill(lessonText, 36, GOLD,  "bold",   TEXT_Y + 20);
    const cta1    = await textPill(ctaText,    38, WHITE, "bold",   TEXT_Y);

    const FRAMES = [
        { buf: await buildFrame(hook1.items),                              dur: 5  },
        { buf: await buildFrame([...story1.items,  ...story2.items]),      dur: 10 },
        { buf: await buildFrame([...lesson1.items, ...lesson2.items]),     dur: 10 },
        { buf: await buildFrame(cta1.items),                               dur: 5  },
    ];

    // Write temp JPEG files
    const framePaths = FRAMES.map((_, i) => path.join(dir, `mb_f${i + 1}_${ts}.jpg`));
    await Promise.all(FRAMES.map((f, i) => sharp(f.buf).jpeg({ quality: 92 }).toFile(framePaths[i])));

    // ── FFmpeg: 4 frames → 30s video + music ─────────────────────────────────
    const musicPath = pickMusic();
    console.log(`   Music: ${path.basename(musicPath)}`);

    const DURATION   = 30;
    const inputArgs  = FRAMES.map((f, i) => `-loop 1 -framerate 30 -t ${f.dur} -i "${framePaths[i]}"`).join(" ");
    const concatFilt = FRAMES.map((_, i) => `[${i}:v]`).join("") +
        `concat=n=${FRAMES.length}:v=1:a=0[cv];` +
        `[cv]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,` +
        `fade=t=in:st=0:d=1,fade=t=out:st=${DURATION - 1}:d=1[vout]`;

    const cmd = [
        "ffmpeg -y",
        inputArgs,
        `-i "${musicPath}"`,
        `-filter_complex "${concatFilt}"`,
        `-map "[vout]" -map ${FRAMES.length}:a`,
        `-t ${DURATION}`,
        `-c:v libx264 -preset fast -profile:v baseline -level 3.1 -crf 23 -pix_fmt yuv420p -r 30 -threads 2`,
        `-c:a aac -b:a 128k -ar 44100 -ac 2 -shortest`,
        `-movflags +faststart`,
        `"${videoPath}"`,
    ].join(" ");

    execSync(cmd, { stdio: "pipe" });
    framePaths.forEach(p => { try { fs.unlinkSync(p); } catch (_) {} });
    console.log(`✅ Video created: ${path.basename(videoPath)}`);
}

// ── Main exported function ────────────────────────────────────────────────────
async function generateMahabharatVideo({ script, epNumber = 1, outputDir = __dirname } = {}) {
    const ts        = Date.now();
    const imagePath = path.join(outputDir, `mb_image_${ts}.png`);
    const videoPath = path.join(outputDir, `mb_video_${ts}.mp4`);

    const imagePrompt = await generateImagePrompt(script);
    await generateImage(imagePrompt, imagePath, script.character);

    try {
        await compositeVideo(imagePath, script, epNumber, videoPath);
    } catch (err) {
        // Return imagePath so caller can upload it as a fallback
        throw Object.assign(err, { imagePath });
    }

    try { fs.unlinkSync(imagePath); } catch (_) {}
    return videoPath;
}

module.exports = { generateMahabharatVideo };
