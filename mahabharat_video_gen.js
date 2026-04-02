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
const CREAM  = "#F5EDD8";

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

// ── Step 3: Composite overlays + text ────────────────────────────────────────
async function compositeVideo(imagePath, script, epNumber, videoPath) {
    console.log("🔄 Step 3/4 — Compositing overlays + rendering video...");

    const FONT_PATH = path.resolve(__dirname, "fonts", "NotoSansTelugu.ttf");
    const jpegPath  = imagePath.replace(/\.png$/, "_comp.jpg");

    // Resize + flatten base
    const baseBuffer = await sharp(imagePath)
        .resize(W, H, { fit: "cover", position: "center" })
        .flatten({ background: "#000000" })
        .toBuffer();

    const composites = [];

    // ── Top dark gradient overlay (for EP badge + character) ─────────────────
    const topGradH = Math.floor(H * 0.30);
    const topSvg   = `<svg width="${W}" height="${topGradH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="#000000" stop-opacity="0.85"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${topGradH}" fill="url(#tg)"/>
    </svg>`;
    composites.push({ input: await sharp(Buffer.from(topSvg)).png().toBuffer(), top: 0, left: 0 });

    // ── Bottom dark gradient overlay (for title text) ─────────────────────────
    const botGradH = Math.floor(H * 0.40);
    const botSvg   = `<svg width="${W}" height="${botGradH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="#000000" stop-opacity="0"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0.92"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${botGradH}" fill="url(#bg)"/>
    </svg>`;
    composites.push({ input: await sharp(Buffer.from(botSvg)).png().toBuffer(), top: H - botGradH, left: 0 });

    // ── Helper: Pango text ────────────────────────────────────────────────────
    async function pangoText(text, sizePt, color, weight, topY, maxW) {
        const w      = maxW || W - 80;
        const markup = `<span font_family="Noto Sans Telugu" font_size="${sizePt}pt" font_weight="${weight}" foreground="${color}">${escapeXml(text)}</span>`;
        const buf    = await sharp({ text: { text: markup, fontfile: FONT_PATH, width: w, rgba: true, dpi: 96, align: "centre" } }).png().toBuffer();
        const { width: tw, height: th } = await sharp(buf).metadata();
        const left = Math.max(0, Math.floor((W - (tw || w)) / 2));
        return { input: buf, top: topY, left, _h: th || 0 };
    }

    // ── TOP AREA: EP badge + Character name ───────────────────────────────────
    const epText   = `EP ${String(epNumber).padStart(2, "0")}  •  ${script.character || ""}`;
    const epEl     = await pangoText(epText, 28, GOLD, "bold", 60);
    composites.push(epEl);

    // Category tag below EP
    const catEl = await pangoText(script.category || "", 24, "rgba(255,255,255,0.7)", "normal", epEl.top + epEl._h + 10);
    composites.push(catEl);

    // ── BOTTOM AREA: Title (large) + Hook (smaller) ───────────────────────────
    // Title: 2 lines max
    const title      = script.title || "";
    const titleWords = title.split(/\s+/);
    // Split into 2 lines of ~5 words each
    const line1 = titleWords.slice(0, Math.ceil(titleWords.length / 2)).join(" ");
    const line2 = titleWords.slice(Math.ceil(titleWords.length / 2)).join(" ");

    const titleY1 = H - botGradH + Math.floor(botGradH * 0.28);
    const t1 = await pangoText(line1, 52, WHITE, "bold", titleY1);
    composites.push(t1);
    let ty = t1.top + t1._h + 8;
    if (line2) {
        const t2 = await pangoText(line2, 52, WHITE, "bold", ty);
        composites.push(t2);
        ty = t2.top + t2._h + 20;
    } else {
        ty += 20;
    }

    // Thin gold divider
    const divW = 160;
    const divBuf = await sharp({ create: { width: divW, height: 3, channels: 4, background: { r: 201, g: 168, b: 76, alpha: 0.8 } } }).png().toBuffer();
    composites.push({ input: divBuf, top: ty, left: Math.floor((W - divW) / 2) });
    ty += 18;

    // Hook text (first line only — teaser)
    const hookPreview = (script.hook || "").split(/[.!?]/)[0]?.trim() || script.hook || "";
    const hookEl = await pangoText(hookPreview, 32, CREAM, "normal", ty);
    composites.push(hookEl);

    // ── Write composite ───────────────────────────────────────────────────────
    await sharp(baseBuffer)
        .composite(composites)
        .jpeg({ quality: 92 })
        .toFile(jpegPath);

    // ── Generate voice narration ──────────────────────────────────────────────
    const fullScript = [script.hook, script.story, script.lesson, script.cta]
        .filter(Boolean).join(". ");

    let audioPath;
    const DURATION = 30;

    if (process.env.ELEVENLABS_API_KEY) {
        console.log("   Generating voice narration...");
        const { generateVoice } = require("./src/services/voiceGenerator");
        try {
            audioPath = await generateVoice(fullScript);
        } catch (e) {
            console.warn("   ElevenLabs failed, using music only:", e.message);
        }
    }

    // ── FFmpeg: image → 30s video ─────────────────────────────────────────────
    const musicPath = pickMusic();
    console.log(`   Music: ${path.basename(musicPath)}`);

    let cmd;
    if (audioPath) {
        const mixedPath = jpegPath.replace("_comp.jpg", "_mixed.mp3");
        // Mix voice + music
        execSync(
            `ffmpeg -y -i "${audioPath}" -i "${musicPath}" ` +
            `-filter_complex "[1:a]volume=0.18[m];[0:a][m]amix=inputs=2:duration=first[out]" ` +
            `-map "[out]" -t ${DURATION} -c:a aac -b:a 128k -ar 44100 -ac 2 "${mixedPath}"`,
            { stdio: "pipe" }
        );
        cmd = [
            "ffmpeg -y",
            `-loop 1 -framerate 30 -i "${jpegPath}"`,
            `-i "${mixedPath}"`,
            `-vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fade=t=in:st=0:d=1,fade=t=out:st=${DURATION - 1}:d=1"`,
            `-t ${DURATION}`,
            `-c:v libx264 -preset fast -profile:v baseline -level 3.1 -crf 23 -pix_fmt yuv420p -r 30 -threads 2`,
            `-c:a aac -b:a 128k -ar 44100 -ac 2 -shortest`,
            `-movflags +faststart`,
            `"${videoPath}"`,
        ].join(" ");
        execSync(cmd, { stdio: "pipe" });
        try { fs.unlinkSync(mixedPath); } catch (_) {}
        try { fs.unlinkSync(audioPath); } catch (_) {}
    } else {
        cmd = [
            "ffmpeg -y",
            `-loop 1 -framerate 30 -i "${jpegPath}"`,
            `-i "${musicPath}"`,
            `-vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fade=t=in:st=0:d=1,fade=t=out:st=${DURATION - 1}:d=1"`,
            `-t ${DURATION}`,
            `-c:v libx264 -preset fast -profile:v baseline -level 3.1 -crf 23 -pix_fmt yuv420p -r 30 -threads 2`,
            `-c:a aac -b:a 128k -ar 44100 -ac 2 -shortest`,
            `-movflags +faststart`,
            `"${videoPath}"`,
        ].join(" ");
        execSync(cmd, { stdio: "pipe" });
    }

    try { fs.unlinkSync(jpegPath); } catch (_) {}
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
