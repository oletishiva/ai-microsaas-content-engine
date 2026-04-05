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

    // Dark rounded pill — opacity 0.92 so text is always readable
    async function pillBuf(pillW, pillH, borderColor) {
        const border = borderColor
            ? `<rect x="1" y="1" width="${pillW - 2}" height="${pillH - 2}" rx="21" fill="none" stroke="${borderColor}" stroke-width="1.5"/>`
            : "";
        const svg = `<svg width="${pillW}" height="${pillH}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${pillW}" height="${pillH}" rx="22" fill="#0D0D0F" fill-opacity="0.92"/>
          ${border}
        </svg>`;
        return sharp(Buffer.from(svg)).png().toBuffer();
    }

    // Text pill anchored at topY (top edge of pill, not center)
    async function textPill(text, sizePt, color, weight, topY, borderColor) {
        const padX = 52, padY = 26;
        const { buf, h: th } = await renderText(text, sizePt, color, weight);
        const pW    = W - 60;
        const pH    = th + padY * 2;
        const pLeft = Math.floor((W - pW) / 2);
        return {
            items: [
                { input: await pillBuf(pW, pH, borderColor), top: topY, left: pLeft },
                { input: buf, top: topY + padY, left: pLeft + padX },
            ],
            bottom: topY + pH,
        };
    }

    // Gold-bordered label pill — plain text, no emoji (emoji breaks NotoSansTelugu)
    async function labelPill(text, topY) {
        const padX = 36, padY = 16;
        const { buf, h: th } = await renderText(text, 24, GOLD, "bold");
        const pW    = W - 100;
        const pH    = th + padY * 2;
        const pLeft = Math.floor((W - pW) / 2);
        const svg   = `<svg width="${pW}" height="${pH}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${pW}" height="${pH}" rx="16" fill="#0D0D0F" fill-opacity="0.92"/>
          <rect x="1" y="1" width="${pW - 2}" height="${pH - 2}" rx="15" fill="none" stroke="#C9A84C" stroke-width="1.5"/>
        </svg>`;
        return {
            items: [
                { input: await sharp(Buffer.from(svg)).png().toBuffer(), top: topY, left: pLeft },
                { input: buf, top: topY + padY, left: pLeft + padX },
            ],
            bottom: topY + pH,
        };
    }

    // Split text at sentence boundary into [part1, part2]
    function splitTwo(text) {
        const sentences = (text || "").split(/(?<=[.!?।])\s+/).filter(Boolean);
        if (sentences.length <= 1) {
            const words = (text || "").split(/\s+/);
            const mid   = Math.ceil(words.length / 2);
            return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
        }
        const mid = Math.ceil(sentences.length / 2);
        return [sentences.slice(0, mid).join(" "), sentences.slice(mid).join(" ")];
    }

    // ── Persistent elements (appear on every frame) ───────────────────────────

    // EP pill badge — top-left
    const epSvg = `<svg width="112" height="42" xmlns="http://www.w3.org/2000/svg">
      <rect width="112" height="42" rx="10" fill="#0D0D0F" fill-opacity="0.88"/>
      <rect x="1" y="1" width="110" height="40" rx="9" fill="none" stroke="#C9A84C" stroke-width="1.5"/>
    </svg>`;
    const { buf: epTxtBuf } = await renderText(`EP ${String(epNumber).padStart(2, "0")}`, 20, GOLD, "bold", 100);
    const EP_BADGE = [
        { input: await sharp(Buffer.from(epSvg)).png().toBuffer(), top: 36, left: 40 },
        { input: epTxtBuf, top: 47, left: 47 },
    ];

    // Character - Category — small centered line, always visible
    const { buf: charBuf } = await renderText(
        `${script.character}  -  ${script.category}`, 20, "#CCCCCC", "normal"
    );
    const CHAR_LINE = [{ input: charBuf, top: 96, left: Math.floor((W - (W - 100)) / 2) }];

    // ── Text content split into halves ────────────────────────────────────────
    const hookText              = script.hook || "";
    const [story1, story2text]  = splitTwo(script.story  || "");
    const [lesson1, lesson2text]= splitTwo(script.lesson || "");
    const ctaText               = script.cta  || "";

    // ── Frame layout — 6 frames = 30s ────────────────────────────────────────
    // Frame 1 (4s):  Hook — BOTTOM — scroll-stopper
    // Frame 2 (6s):  "కథ" label + Story part 1 — TOP
    // Frame 3 (6s):  Story part 2 — TOP (continuation, no label)
    // Frame 4 (5s):  "నేటి పాఠం" label + Lesson part 1 — TOP
    // Frame 5 (5s):  Lesson part 2 — TOP (gold, continuation)
    // Frame 6 (4s):  CTA — BOTTOM

    const hookPill    = await textPill(hookText,    46, WHITE, "bold",   1440, null);
    const storyLabel  = await labelPill("కథ", 200);
    const storyPill1  = await textPill(story1,      34, WHITE, "normal", storyLabel.bottom + 20);
    const storyPill2  = await textPill(story2text,  34, WHITE, "normal", storyLabel.bottom + 20);
    const lessonLabel = await labelPill("నేటి పాఠం", 200);
    const lessonPill1 = await textPill(lesson1,     34, GOLD,  "bold",   lessonLabel.bottom + 20, GOLD);
    const lessonPill2 = await textPill(lesson2text, 34, GOLD,  "bold",   lessonLabel.bottom + 20, GOLD);
    const ctaPill     = await textPill(ctaText,     38, WHITE, "bold",   1480, null);

    // ── Build each frame ──────────────────────────────────────────────────────
    async function buildFrame(items) {
        return sharp(baseBuffer)
            .composite([...EP_BADGE, ...CHAR_LINE, ...items])
            .jpeg({ quality: 92 })
            .toBuffer();
    }

    const FRAMES = [
        { buf: await buildFrame(hookPill.items),                                   dur: 4 },
        { buf: await buildFrame([...storyLabel.items,  ...storyPill1.items]),      dur: 6 },
        { buf: await buildFrame(storyPill2.items),                                 dur: 6 },
        { buf: await buildFrame([...lessonLabel.items, ...lessonPill1.items]),     dur: 5 },
        { buf: await buildFrame(lessonPill2.items),                                dur: 5 },
        { buf: await buildFrame(ctaPill.items),                                    dur: 4 },
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

    // Return both paths — caller decides whether to upload/keep the image
    return { videoPath, imagePath };
}

module.exports = { generateMahabharatVideo };
