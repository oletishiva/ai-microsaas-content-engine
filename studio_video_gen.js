/**
 * studio_video_gen.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Flexible AI video generator — guided (hook+quote) or free-form prompt
 *
 * Pipeline:
 *   1. Claude → interpret content + generate scene visual prompts
 *   2. Per scene: use uploaded image OR generate via Gemini (→ DALL-E fallback)
 *   3. Sharp → composite text overlay on each scene
 *   4. FFmpeg → Ken Burns clip per scene
 *   5. FFmpeg → concat all clips + optional music
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

// ── Language config ────────────────────────────────────────────────────────
const LANGUAGES = {
    english:  { name: "English",  isLatin: true  },
    telugu:   { name: "Telugu",   isLatin: false },
    hindi:    { name: "Hindi",    isLatin: false },
    tamil:    { name: "Tamil",    isLatin: false },
    kannada:  { name: "Kannada",  isLatin: false },
};

const FONT_LATIN  = path.resolve(__dirname, "fonts", "Caveat-Bold.ttf");
const FONT_INDIC  = path.resolve(__dirname, "fonts", "NotoSansTelugu.ttf");

// ── Style flavors (injected into DALL-E / Gemini prompts) ─────────────────
const STYLE_DESCRIPTORS = {
    cinematic:    "cinematic, dramatic golden-hour lighting, atmospheric depth, photorealistic, rich tones",
    cultural:     "traditional South Indian cultural setting — ancient temples, marigold festivals, oil lamps, coconut palms, warm amber palette",
    illustrated:  "vibrant digital illustration, painterly brushwork, bold colors, artistic poster style",
    minimal:      "ultra-minimalist, clean negative space, single focal element, pastel gradient, modern editorial",
    nature:       "breathtaking nature — misty mountains, golden sunlight through forest, river reflections, serene and majestic",
};

// ── Helpers ────────────────────────────────────────────────────────────────
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

function pickMusic() {
    const dir   = path.resolve(__dirname, "music");
    const files = fs.readdirSync(dir).filter(f => /\.(mp3|m4a|wav)$/i.test(f));
    if (!files.length) throw new Error("No music files found in music/");
    return path.join(dir, files[Math.floor(Math.random() * files.length)]);
}

// ── Step 1: Claude — interpret content + generate scene prompts ────────────
async function interpretContent({ mode, language, hook, quote, subtext, userPrompt, scenes, style }) {
    const client    = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    const langName  = LANGUAGES[language]?.name || "English";
    const styleMood = STYLE_DESCRIPTORS[style] || STYLE_DESCRIPTORS.cinematic;

    if (mode === "guided") {
        // User has the text — Claude only generates the scene visual prompts
        const resp = await client.messages.create({
            model: "claude-sonnet-4-6", max_tokens: 700,
            system: `You generate DALL-E 3 image prompts for a ${scenes}-scene vertical (9:16) short-form video.
Visual style: ${styleMood}
Rules:
- Each prompt describes a single atmospheric, symbolic scene — NO text, NO readable words, NO borders, NO frames
- Emotionally resonant, visually stunning, fills the full frame
- Vary compositions across scenes (wide, medium, close-up, aerial, etc.)
- DALL-E SAFETY (critical): never mention weapons, battles, fighting, war, violence, blood, death, injuries, killing, or armies. Convey war/conflict themes through symbolism — cracked earth, storm clouds, lone figures at dusk, scattered petals, a single flame, divine light breaking through darkness.
- Return ONLY a JSON array of exactly ${scenes} prompt strings: ["...", ...]`,
            messages: [{ role: "user", content: `Create ${scenes} scene prompts for a video about:
Hook: "${hook || ""}"
Quote: "${quote || ""}"
Subtext: "${subtext || ""}"
Language context: ${langName}
Make the scenes emotionally support the message.` }],
        });
        const raw = resp.content[0].text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        return { hook, quote, subtext, scenePrompts: JSON.parse(raw) };

    } else {
        // Prompt mode — Claude generates everything: hook, quote, subtext, scene prompts
        const resp = await client.messages.create({
            model: "claude-sonnet-4-6", max_tokens: 900,
            system: `You are a creative director specializing in short-form social video content.
Given a free-form description, produce a complete video concept.

Target language: ${langName}
Visual style: ${styleMood}
Number of scenes: ${scenes}

Return ONLY valid JSON — no markdown, no explanation:
{
  "hook": "scroll-stopping opening line in ${langName} (max 12 words)",
  "quote": "central message / main quote in ${langName} (max 20 words)",
  "subtext": "supporting thought in ${langName} (max 8 words, optional — empty string if not needed)",
  "scenePrompts": ["dall-e prompt 1", ..., "dall-e prompt ${scenes}"]
}

scenePrompts rules:
- Each is a DALL-E 3 image generation prompt: ${styleMood}
- NO text, NO readable words, NO people faces, NO borders — pure atmosphere and symbolism
- Exactly ${scenes} prompts, varied compositions
- DALL-E SAFETY (critical): never mention weapons, battles, fighting, war, violence, blood, death, injuries, killing, or armies. Convey conflict/epic themes through symbolism — lone silhouette at sunset, storm clouds parting, divine golden light, cracked ancient earth, scattered lotus petals, a single flame in darkness, grand temple at twilight.`,
            messages: [{ role: "user", content: userPrompt }],
        });
        const raw = resp.content[0].text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        return JSON.parse(raw);
    }
}

// ── Step 2a: Gemini Imagen ─────────────────────────────────────────────────
async function generateGeminiImage(prompt, destPath) {
    const { GoogleGenAI } = require("@google/genai");
    const MODELS = ["imagen-3.0-generate-002", "imagen-3.0-fast-generate-001"];
    for (const model of MODELS) {
        try {
            const ai   = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const resp = await ai.models.generateImages({
                model,
                prompt: `${prompt}. Vertical 9:16 portrait format, full bleed.`,
                config: { numberOfImages: 1, outputMimeType: "image/png", aspectRatio: "9:16" },
            });
            const b64 = resp.generatedImages?.[0]?.image?.imageBytes;
            if (!b64) throw new Error("No image bytes returned");
            fs.writeFileSync(destPath, Buffer.from(b64, "base64"));
            return;
        } catch (err) {
            if (MODELS.indexOf(model) === MODELS.length - 1) throw err;
        }
    }
}

// ── Step 2b: DALL-E 3 (with safety-rejection retry) ───────────────────────
async function generateDalleImage(prompt, destPath) {
    const openai = new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY });

    async function tryGenerate(p) {
        const response = await openai.images.generate({
            model: "dall-e-3", prompt: p, n: 1, size: "1024x1792", quality: "hd",
        });
        await downloadFile(response.data[0].url, destPath);
    }

    try {
        await tryGenerate(prompt);
    } catch (err) {
        // Safety rejection — strip conflict/epic terms and retry once with a safe fallback
        if (err?.status === 400 || err?.message?.includes("safety")) {
            console.log("   ⚠️ DALL-E safety rejection — retrying with sanitized prompt...");
            const safe = prompt
                .replace(/\b(war|battle|fight|warrior|soldier|weapon|sword|arrow|spear|blood|death|kill|dead|army|combat|violence|attack|destroy|enemy|defeat)\b/gi, "")
                .replace(/\s{2,}/g, " ")
                .trim();
            const fallback = safe.length > 30
                ? `${safe}, cinematic, atmospheric, symbolism, golden light, emotional depth, 9:16 portrait`
                : "ancient Indian landscape at golden hour, divine light, lotus flowers, temple silhouette, dramatic sky, cinematic, 9:16 portrait";
            await tryGenerate(fallback);
        } else {
            throw err;
        }
    }
}

// ── Step 3: Sharp — composite text overlay ────────────────────────────────
async function compositeScene(imagePath, sceneIdx, totalScenes, content, language, outputPath) {
    const { hook, quote, subtext } = content;
    const lang      = LANGUAGES[language] || LANGUAGES.english;
    const FONT_PATH = lang.isLatin ? FONT_LATIN : FONT_INDIC;
    const TEXT_W    = Math.round(W * 0.80); // 864px — 80% width, 10% padding each side
    const maxChars  = lang.isLatin ? 28 : 22;

    const base = await sharp(imagePath)
        .resize(W, H, { fit: "cover", position: "center" })
        .flatten({ background: "#000000" })
        .toBuffer();

    const composites = [];

    async function rt(text, sizePt, color, weight) {
        const family = lang.isLatin ? "Caveat" : "Noto Sans Telugu";
        const markup = `<span font_family="${family}" font_size="${sizePt}pt" font_weight="${weight}" foreground="${color}">${escapeXml(text)}</span>`;
        const buf    = await sharp({ text: { text: markup, fontfile: FONT_PATH, width: TEXT_W, rgba: true, dpi: 96, align: "centre" } }).png().toBuffer();
        const { width: w, height: h } = await sharp(buf).metadata();
        return { buf, w: w || TEXT_W, h: h || 0 };
    }

    // ── Top gradient ──────────────────────────────────────────────────────
    const topH   = 220;
    const topSvg = `<svg width="${W}" height="${topH}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#000" stop-opacity="0.85"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0"/>
      </linearGradient></defs>
      <rect width="${W}" height="${topH}" fill="url(#tg)"/>
    </svg>`;
    composites.push({ input: await sharp(Buffer.from(topSvg)).png().toBuffer(), top: 0, left: 0 });

    // ── Hook — only on scene 0, large at top ──────────────────────────────
    if (sceneIdx === 0 && hook) {
        let hookY = 44;
        for (const line of wrapText(hook, maxChars)) {
            const { buf, w, h } = await rt(line, lang.isLatin ? 44 : 38, "#FFFFFF", "bold");
            composites.push({ input: buf, top: hookY, left: Math.floor((W - w) / 2) });
            hookY += h + 8;
        }
    }

    // ── Bottom gradient ────────────────────────────────────────────────────
    const botH   = Math.floor(H * 0.52);
    const botSvg = `<svg width="${W}" height="${botH}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#000" stop-opacity="0"/>
        <stop offset="28%"  stop-color="#000" stop-opacity="0.50"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0.92"/>
      </linearGradient></defs>
      <rect width="${W}" height="${botH}" fill="url(#bg)"/>
    </svg>`;
    composites.push({ input: await sharp(Buffer.from(botSvg)).png().toBuffer(), top: H - botH, left: 0 });

    // ── Quote — large centered text ────────────────────────────────────────
    let textY = H - botH + Math.floor(botH * 0.18);
    for (const line of wrapText(quote || "", maxChars)) {
        const { buf, w, h } = await rt(line, lang.isLatin ? 64 : 52, "#FFFFFF", "900");
        composites.push({ input: buf, top: textY, left: Math.floor((W - w) / 2) });
        textY += h + 10;
    }

    // ── Subtext + divider — only on last scene ─────────────────────────────
    if (sceneIdx === totalScenes - 1 && subtext) {
        textY += 20;
        const lineW   = 110;
        const lineBuf = await sharp({
            create: { width: lineW, height: 2, channels: 4, background: { r: 252, g: 211, b: 77, alpha: 0.6 } },
        }).png().toBuffer();
        composites.push({ input: lineBuf, top: textY, left: Math.floor((W - lineW) / 2) });
        textY += 14;
        const { buf, w } = await rt(subtext, lang.isLatin ? 32 : 28, "#C8C8C8", "normal");
        composites.push({ input: buf, top: textY, left: Math.floor((W - w) / 2) });
    }

    // ── Branding ───────────────────────────────────────────────────────────
    const { buf: brandBuf, w: brandW } = await rt("✨ AI Studio", 20, "#E8BF45", "bold");
    composites.push({ input: brandBuf, top: H - 50, left: Math.floor((W - brandW) / 2) });

    await sharp(base).composite(composites).jpeg({ quality: 92 }).toFile(outputPath);
}

// ── Step 4: FFmpeg — Ken Burns clip ───────────────────────────────────────
function makeClip(imagePath, clipPath, duration, direction) {
    const SW   = Math.round(W * 1.08);
    const SH   = Math.round(H * 1.08);
    const panX = SW - W;
    const panY = Math.floor((SH - H) / 2);
    const cropX = direction === "ltr"
        ? `${panX}*(t/${duration})`
        : `${panX}*(1-t/${duration})`;

    const vf = [
        `scale=${SW}:${SH}`,
        `crop=${W}:${H}:'${cropX}':${panY}`,
        `fade=t=in:st=0:d=0.5`,
        `fade=t=out:st=${duration - 0.5}:d=0.5`,
        `format=yuv420p`,
    ].join(",");

    const cmd = [
        "ffmpeg -y",
        `-loop 1 -framerate 30 -i "${imagePath}"`,
        `-vf "${vf}"`,
        `-t ${duration}`,
        `-c:v libx264 -preset fast -profile:v baseline -level 3.1 -crf 23 -pix_fmt yuv420p -r 30 -threads 1`,
        `-an`,
        `"${clipPath}"`,
    ].join(" ");

    execSync(cmd, { stdio: "pipe", timeout: 90000 });
}

// ── Step 5: Concat clips + add music ──────────────────────────────────────
function stitchVideo(clipPaths, musicEnabled, outputPath) {
    if (clipPaths.length === 1 && !musicEnabled) {
        fs.copyFileSync(clipPaths[0], outputPath);
        return;
    }

    const listFile = outputPath.replace(".mp4", "_list.txt");
    fs.writeFileSync(listFile, clipPaths.map(p => `file '${p}'`).join("\n"));

    let cmd;
    if (musicEnabled) {
        const musicPath = pickMusic();
        cmd = [
            "ffmpeg -y",
            `-f concat -safe 0 -i "${listFile}"`,
            `-i "${musicPath}"`,
            `-c:v copy`,
            `-c:a aac -b:a 128k -ar 44100 -ac 2 -shortest`,
            `-movflags +faststart`,
            `"${outputPath}"`,
        ].join(" ");
    } else {
        cmd = [
            "ffmpeg -y",
            `-f concat -safe 0 -i "${listFile}"`,
            `-c:v copy -an`,
            `-movflags +faststart`,
            `"${outputPath}"`,
        ].join(" ");
    }

    execSync(cmd, { stdio: "pipe", timeout: 180000 });
    try { fs.unlinkSync(listFile); } catch (_) {}
}

// ── Main ──────────────────────────────────────────────────────────────────
async function generateStudioVideo({
    mode        = "guided",
    language    = "english",
    hook        = "",
    quote       = "",
    subtext     = "",
    userPrompt  = "",
    scenes      = 2,
    style       = "cinematic",
    duration    = 30,
    music       = true,
    localImages = {}, // { 0: "/abs/path/img0.jpg", 1: "...", ... }
    outputDir   = __dirname,
    onProgress  = () => {}, // (event) => void — called with real-time progress
} = {}) {
    const ts          = Date.now();
    const clipDuration = Math.round((duration / scenes) * 10) / 10;

    console.log(`\n🎬 Studio — ${mode} | ${language} | ${scenes} scenes | ${duration}s`);

    // 1. Interpret content
    onProgress({ pct: 5, label: "Interpreting content with Claude..." });
    console.log("🔄 Step 1 — Interpreting content via Claude...");
    const content = await interpretContent({ mode, language, hook, quote, subtext, userPrompt, scenes, style });
    console.log(`   ✅ hook: "${(content.hook || "").slice(0, 50)}"`);
    console.log(`   ✅ quote: "${(content.quote || "").slice(0, 50)}"`);
    onProgress({ pct: 12, label: `Content ready — generating ${scenes} scene image${scenes > 1 ? "s" : ""}...` });

    const clipPaths  = [];
    let firstImgPath  = null;
    let firstCompPath = null;

    // Images take the bulk of the time: 12% → 70% spread across scenes
    const imgPctStart = 12, imgPctEnd = 70;
    const imgPctStep  = (imgPctEnd - imgPctStart) / scenes;

    for (let i = 0; i < scenes; i++) {
        console.log(`\n🔄 Scene ${i + 1}/${scenes}...`);
        const imgPath  = path.join(outputDir, `studio_img_${ts}_${i}.png`);
        const compPath = path.join(outputDir, `studio_comp_${ts}_${i}.jpg`);
        const clipPath = path.join(outputDir, `studio_clip_${ts}_${i}.mp4`);

        // 2. Image: local upload OR AI-generated
        onProgress({ pct: Math.round(imgPctStart + imgPctStep * i), label: `Generating scene ${i + 1} of ${scenes} image...` });
        if (localImages[i]) {
            console.log(`   📎 Using uploaded image`);
            fs.copyFileSync(localImages[i], imgPath);
        } else {
            const scenePrompt = content.scenePrompts?.[i] || content.quote || "cinematic landscape";
            if (process.env.GEMINI_API_KEY) {
                try {
                    await generateGeminiImage(scenePrompt, imgPath);
                    console.log(`   ✅ Gemini image generated`);
                } catch (geminiErr) {
                    console.log(`   ⚠️ Gemini failed (${geminiErr.message}) — trying DALL-E...`);
                    onProgress({ pct: Math.round(imgPctStart + imgPctStep * i + imgPctStep * 0.5), label: `Scene ${i + 1}: Gemini failed, retrying with DALL-E...` });
                    await generateDalleImage(scenePrompt, imgPath);
                    console.log(`   ✅ DALL-E image generated`);
                }
            } else if (process.env.OPENAI_API_KEY) {
                await generateDalleImage(scenePrompt, imgPath);
                console.log(`   ✅ DALL-E image generated`);
            } else {
                throw new Error("No image API configured — set GEMINI_API_KEY or OPENAI_API_KEY");
            }
        }

        if (i === 0) firstImgPath = imgPath;

        // 3. Composite text overlay
        onProgress({ pct: Math.round(imgPctStart + imgPctStep * (i + 0.7)), label: `Compositing text on scene ${i + 1}...` });
        console.log(`   ✍️  Compositing text...`);
        await compositeScene(imgPath, i, scenes, content, language, compPath);

        if (i === 0) firstCompPath = compPath;

        // 4. Ken Burns clip
        onProgress({ pct: Math.round(imgPctStart + imgPctStep * (i + 0.9)), label: `Rendering scene ${i + 1} clip...` });
        console.log(`   🎬 Rendering ${clipDuration}s clip...`);
        makeClip(compPath, clipPath, clipDuration, i % 2 === 0 ? "ltr" : "rtl");
        clipPaths.push(clipPath);

        // Cleanup non-first raw image + composite (only keep scene 0 for sharing)
        if (i > 0) {
            try { fs.unlinkSync(imgPath);  } catch (_) {}
            try { fs.unlinkSync(compPath); } catch (_) {}
        }
    }

    // 5. Stitch + music
    onProgress({ pct: 72, label: music ? "Stitching clips and adding music..." : "Stitching clips..." });
    const videoPath = path.join(outputDir, `studio_video_${ts}.mp4`);
    console.log("\n🔄 Stitching clips...");
    stitchVideo(clipPaths, music, videoPath);
    for (const cp of clipPaths) { try { fs.unlinkSync(cp); } catch (_) {} }
    onProgress({ pct: 88, label: "Uploading to Cloudinary..." });

    console.log("✅ Studio video complete!");
    return {
        videoPath,
        imagePath:         firstImgPath,
        compositeImagePath: firstCompPath,
        hook:    content.hook    || hook,
        quote:   content.quote   || quote,
        subtext: content.subtext || subtext,
        language,
    };
}

module.exports = { generateStudioVideo, LANGUAGES, STYLES: STYLE_DESCRIPTORS };
