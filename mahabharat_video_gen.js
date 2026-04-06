/**
 * mahabharat_video_gen.js  v2 — Cinematic Multi-Scene
 * ─────────────────────────────────────────────────────
 * Generates a ~30s cinematic Mahabharat Short with 4 DISTINCT scene images.
 *
 * Why 4 scenes work better on YouTube Shorts:
 *   - Each scene = new visual stimulus → viewer keeps watching
 *   - Different mood per section (hook → story → lesson → CTA)
 *   - xfade transitions feel professional, not slideshow
 *   - Full-bleed cinematic images with dark gradient text → no more cream box
 *
 * Pipeline:
 *   1. Claude → 4 scene-specific image prompts from the script
 *   2. Gemini Imagen 3 (primary) or DALL-E 3 (fallback) → 4 × 1080×1920 images
 *   3. Sharp → cinematic overlay per image (top vignette + bottom dark gradient + text)
 *   4. FFmpeg → 4 clips with optional Ken Burns zoom
 *   5. FFmpeg → xfade merge + background music → final 30s video
 *
 * ENV:
 *   GEMINI_API_KEY       — Gemini Imagen 3 (set this for best quality)
 *   OPENAI_API_KEY       — DALL-E 3 fallback (if Gemini not set/fails)
 *   ANTHROPIC_API_KEY    — Claude scene prompt generation
 *   MAHABHARAT_ZOOM=true — Enable Ken Burns zoom (slower but cinematic, default off)
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

// ── Constants ─────────────────────────────────────────────────────────────────
const W = 1080, H = 1920;
const GOLD  = "#C9A84C";
const WHITE = "#FFFFFF";

const CLIP_DUR    = 7.5;    // seconds per scene (4 × 7.5 = 30s)
const FADE_DUR    = 0.5;    // xfade crossfade duration
const TOTAL_CLIPS = 4;

// Scene → script section mapping
const SCENES = [
    { section: "hook",   label: "",          textColor: WHITE, textSize: 48 },
    { section: "story",  label: "కథ",        textColor: WHITE, textSize: 38 },
    { section: "lesson", label: "నేటి పాఠం", textColor: GOLD,  textSize: 38 },
    { section: "cta",    label: "",          textColor: WHITE, textSize: 42 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function pickMusic() {
    const dir   = path.resolve(__dirname, "music");
    const files = fs.readdirSync(dir).filter(f => /\.(mp3|m4a|wav)$/i.test(f));
    if (!files.length) throw new Error("No audio files in music/ folder");
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

function escapeXml(str) {
    return String(str || "")
        .replace(/—/g, "-").replace(/–/g, "-").replace(/•/g, "·")
        .replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD]/g, "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Word-wrap Telugu text (splits by spaces)
function wrapText(text, maxCharsPerLine = 20) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = "";
    for (const w of words) {
        const candidate = cur ? `${cur} ${w}` : w;
        if (candidate.length > maxCharsPerLine && cur) {
            lines.push(cur);
            cur = w;
        } else {
            cur = candidate;
        }
    }
    if (cur) lines.push(cur);
    return lines;
}

// ── Step 1: Claude → 4 scene-specific image prompts ──────────────────────────
async function buildScenePrompts(script) {
    console.log("🔄 Step 1/4 — Claude building 4 scene prompts...");
    const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
        model:      "claude-sonnet-4-6",
        max_tokens: 900,
        system: `You are an expert at writing image prompts for Indian mythological art.

Given a Mahabharat short script, write 4 DISTINCT image prompts — one per scene.

Base style to include in each: "Premium Mahabharat illustration, dramatic golden volumetric lighting, ancient India, Amar Chitra Katha meets cinematic concept art, deep saffron sky, royal silk garments, ornate jewelry, no text, no borders, 9:16 portrait orientation"

Safety rules (MUST follow to avoid content filter rejection):
- Avoid: battle, war, blood, death, kill, weapon, sword, fight, arrow
- Use instead: confrontation, divine moment, heroic stance, contemplation, revelation, raises hand, gazes upon, stands before

Scene roles:
1. HOOK — dramatic wide establishing shot, atmospheric, awe-inspiring, scroll-stopping. Large sky, palace or forest background.
2. STORY — the specific incident's emotional peak. Character close-up with intense expression.
3. LESSON — symbolic/metaphorical. Calm wise moment. Soft warm light. Less intense, more reflective.
4. CTA — the main character in a majestic, noble, inspiring pose. Triumphant energy. Looking toward viewer.

Return ONLY valid JSON — array of 4 strings:
["prompt1", "prompt2", "prompt3", "prompt4"]`,
        messages: [{
            role:    "user",
            content: `Character: ${script.character}
Incident: ${script.incident || script.title}
Hook: ${script.hook?.slice(0, 120)}
Lesson: ${script.lesson?.slice(0, 100)}

Generate 4 distinct scene prompts.`,
        }],
    });

    const raw     = response.content[0].text.trim()
        .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const prompts = JSON.parse(raw);
    if (!Array.isArray(prompts) || prompts.length < 4) throw new Error("Invalid prompts array from Claude");
    console.log(`✅ Scene prompts ready`);
    return prompts;
}

// ── Step 2a: Gemini Image Generation ─────────────────────────────────────────
// Tries models in order until one works. Available for standard AI Studio keys:
//   gemini-3.1-flash-image-preview, gemini-3-pro-image-preview, gemini-2.5-flash-image
const GEMINI_IMAGE_MODELS = [
    "gemini-3.1-flash-image-preview",
    "gemini-3-pro-image-preview",
    "gemini-2.5-flash-image",
];

async function generateGeminiImage(prompt, outputPath) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY not set");

    const fullPrompt = `${prompt}\n\nIMPORTANT: Generate as a tall portrait image (9:16 aspect ratio, vertical orientation like a phone screen). All subjects must be fully visible within the frame.`;

    let lastErr;
    for (const model of GEMINI_IMAGE_MODELS) {
        console.log(`   [Gemini] Trying ${model}... (prompt: "${prompt.slice(0, 60)}...")`);
        const t0 = Date.now();
        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                {
                    method:  "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: fullPrompt }] }],
                        generationConfig: { responseModalities: ["IMAGE"] },
                    }),
                }
            );

            console.log(`   [Gemini] HTTP ${res.status} (${Date.now() - t0}ms)`);

            if (!res.ok) {
                const errText = await res.text().catch(() => "");
                console.warn(`   [Gemini] ${model} failed (${res.status}): ${errText.slice(0, 200)}`);
                lastErr = new Error(`Gemini ${res.status}: ${errText.slice(0, 150)}`);
                continue; // try next model
            }

            const data = await res.json();
            const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
            if (!part?.inlineData?.data) {
                console.warn(`   [Gemini] ${model} returned no image: ${JSON.stringify(data).slice(0, 200)}`);
                lastErr = new Error(`Gemini ${model}: no image in response`);
                continue;
            }

            const imgBuf = Buffer.from(part.inlineData.data, "base64");
            fs.writeFileSync(outputPath, imgBuf);
            console.log(`   [Gemini] ✅ ${model} — saved ${path.basename(outputPath)} (${(imgBuf.length / 1024).toFixed(0)} KB, ${Date.now() - t0}ms)`);
            return; // success
        } catch (err) {
            console.warn(`   [Gemini] ${model} threw: ${err.message}`);
            lastErr = err;
        }
    }
    throw lastErr || new Error("All Gemini image models failed");
}

// ── Step 2b: DALL-E 3 fallback ────────────────────────────────────────────────
async function generateDalleImage(prompt, outputPath, character) {
    const openai = new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY });

    const tryGen = async (p) => {
        const r = await openai.images.generate({
            model: "dall-e-3", prompt: p, n: 1,
            size: "1024x1792", quality: "hd",
        });
        return r.data[0].url;
    };

    let url;
    try {
        url = await tryGen(prompt);
    } catch (err) {
        if (err.status === 400 && err.message?.includes("safety")) {
            console.warn("   DALL-E safety hit — using safe fallback prompt");
            url = await tryGen(
                `Premium Mahabharat illustration, ${character || "ancient sage"} in golden light, ` +
                `ornate ancient Indian royal attire, dramatic saffron sky, Amar Chitra Katha art style, ` +
                `emotional intensity, no text, no borders, 9:16 portrait`
            );
        } else throw err;
    }
    await downloadFile(url, outputPath);
}

// ── Step 3: Sharp — cinematic text overlay ────────────────────────────────────
//
// Layout per scene:
//   TOP  ~10%: dark vignette gradient → EP badge (top-left) + character (top-right)
//   MID  ~55%: pure scene image — NO overlay, full impact
//   BOT  ~35%: dark gradient fading up → scene label + section text
//
async function compositeScene(imagePath, sceneIdx, script, epNumber, outputPath) {
    const { section, label, textColor, textSize } = SCENES[sceneIdx];
    const FONT_PATH = path.resolve(__dirname, "fonts", "NotoSansTelugu.ttf");
    const TEXT_W    = W - 120;

    // Base image
    const base = await sharp(imagePath)
        .resize(W, H, { fit: "cover", position: "center" })
        .flatten({ background: "#000000" })
        .toBuffer();

    // Render Pango text → {buf, w, h}
    async function rt(text, sizePt, color, weight) {
        const markup = `<span font_family="Noto Sans Telugu" font_size="${sizePt}pt" font_weight="${weight}" foreground="${color}">${escapeXml(text)}</span>`;
        const buf = await sharp({ text: { text: markup, fontfile: FONT_PATH, width: TEXT_W, rgba: true, dpi: 96, align: "centre" } }).png().toBuffer();
        const { width: w, height: h } = await sharp(buf).metadata();
        return { buf, w: w || TEXT_W, h: h || 0 };
    }

    const composites = [];

    // ── TOP dark vignette ─────────────────────────────────────────────────────
    const topH   = 220;
    const topSvg = `<svg width="${W}" height="${topH}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#000" stop-opacity="0.80"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0"/>
      </linearGradient></defs>
      <rect width="${W}" height="${topH}" fill="url(#tg)"/>
    </svg>`;
    composites.push({ input: await sharp(Buffer.from(topSvg)).png().toBuffer(), top: 0, left: 0 });

    // EP badge — top left
    const epSvg = `<svg width="108" height="40" xmlns="http://www.w3.org/2000/svg">
      <rect width="108" height="40" rx="8" fill="#0D0D0F" fill-opacity="0.85"/>
      <rect x="1" y="1" width="106" height="38" rx="7" fill="none" stroke="${GOLD}" stroke-width="1.5"/>
    </svg>`;
    const { buf: epTxt } = await rt(`EP ${String(epNumber).padStart(2, "0")}`, 20, GOLD, "bold");
    composites.push({ input: await sharp(Buffer.from(epSvg)).png().toBuffer(), top: 32, left: 36 });
    composites.push({ input: epTxt, top: 42, left: 45 });

    // Character name — top right
    const { buf: charBuf, w: charW } = await rt(script.character, 22, "#EEEEEE", "bold");
    composites.push({ input: charBuf, top: 38, left: Math.max(160, W - charW - 36) });

    // ── BOTTOM dark gradient ──────────────────────────────────────────────────
    const botGradH = Math.floor(H * 0.42); // 806px
    const botSvg   = `<svg width="${W}" height="${botGradH}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#000" stop-opacity="0"/>
        <stop offset="40%"  stop-color="#000" stop-opacity="0.60"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0.92"/>
      </linearGradient></defs>
      <rect width="${W}" height="${botGradH}" fill="url(#bg)"/>
    </svg>`;
    composites.push({ input: await sharp(Buffer.from(botSvg)).png().toBuffer(), top: H - botGradH, left: 0 });

    // Section label pill (కథ / నేటి పాఠం)
    let textBottomY = H - 70;

    if (label) {
        const { buf: lblBuf, w: lblW, h: lblH } = await rt(label, 26, GOLD, "bold");
        const pillW = lblW + 60, pillH = lblH + 22;
        const pillSvg = `<svg width="${pillW}" height="${pillH}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${pillW}" height="${pillH}" rx="10" fill="${GOLD}" fill-opacity="0.12"/>
          <rect x="1" y="1" width="${pillW - 2}" height="${pillH - 2}" rx="9" fill="none" stroke="${GOLD}" stroke-width="1.5"/>
        </svg>`;
        const pillTop = textBottomY - pillH;
        composites.push({ input: await sharp(Buffer.from(pillSvg)).png().toBuffer(), top: pillTop, left: Math.floor((W - pillW) / 2) });
        composites.push({ input: lblBuf, top: pillTop + 11, left: Math.floor((W - lblW) / 2) });
        textBottomY = pillTop - 18;
    }

    // Section text — stack lines upward from textBottomY
    const maxChars  = section === "hook" ? 16 : 20;
    const lines     = wrapText(script[section] || "", maxChars).slice(0, 4);
    // Render bottom → top
    for (let i = lines.length - 1; i >= 0; i--) {
        const { buf, w: tw, h: th } = await rt(lines[i], textSize, textColor, "bold");
        textBottomY -= th + 10;
        const top  = Math.max(H - botGradH + 100, textBottomY);
        const left = Math.max(0, Math.floor((W - tw) / 2));
        composites.push({ input: buf, top, left });
    }

    // Bottom branding — "మహాభారతం" on scene 1 and 4
    if (sceneIdx === 0 || sceneIdx === 3) {
        const { buf: brandBuf, w: brandW } = await rt("మహాభారతం", 24, GOLD, "bold");
        composites.push({ input: brandBuf, top: H - 52, left: Math.floor((W - brandW) / 2) });
    }

    await sharp(base).composite(composites).jpeg({ quality: 92 }).toFile(outputPath);
    console.log(`   ✅ Scene ${sceneIdx + 1} composited (${section})`);
}

// ── Step 4: FFmpeg — image → video clip ───────────────────────────────────────
// MAHABHARAT_ZOOM=true → Ken Burns zoompan (cinematic, ~60s/clip)
// default            → fast static clip with fade in/out (~5s/clip)
function buildClip(imagePath, sceneIdx, duration, clipPath) {
    const useZoom = process.env.MAHABHARAT_ZOOM === "true";
    const frames  = Math.floor(duration * 30);

    let vf;
    if (useZoom) {
        const zoomIn  = `min(zoom+0.0010,1.25)`;
        const zoomOut = `if(lte(zoom,1.0),1.25,max(zoom-0.0010,1.0))`;
        const zExpr   = sceneIdx % 2 === 0 ? zoomIn : zoomOut;
        vf = `zoompan=z='${zExpr}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=30,`;
    } else {
        vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},`;
    }
    vf += `fade=t=in:st=0:d=0.4,fade=t=out:st=${duration - 0.5}:d=0.5,format=yuv420p`;

    const cmd = [
        "ffmpeg -y",
        `-loop 1 -framerate 30 -i "${imagePath}"`,
        `-vf "${vf}"`,
        `-t ${duration}`,
        `-c:v libx264 -preset fast -crf 20 -threads 2`,
        `"${clipPath}"`,
    ].join(" ");

    console.log(`   [FFmpeg] Building clip ${sceneIdx + 1}...`);
    const t0 = Date.now();
    try {
        execSync(cmd, { stdio: "pipe", timeout: useZoom ? 180000 : 60000 });
    } catch (err) {
        const stderr = err.stderr?.toString() || err.stdout?.toString() || "";
        console.error(`   [FFmpeg] Clip ${sceneIdx + 1} failed:\n${stderr.slice(-800)}`);
        throw new Error(`FFmpeg clip ${sceneIdx + 1} failed: ${stderr.slice(-300)}`);
    }
    console.log(`   ✅ Clip ${sceneIdx + 1} built (${Date.now() - t0}ms)`);
}

// ── Step 5: xfade merge + music ───────────────────────────────────────────────
function mergeClips(clipPaths, musicPath, videoPath) {
    const n        = clipPaths.length;
    const stepDur  = CLIP_DUR - FADE_DUR;            // 7.0s between xfade offsets
    const totalDur = n * CLIP_DUR - (n - 1) * FADE_DUR; // 28.5s

    const inputs = clipPaths.map(p => `-i "${p}"`).join(" ");

    // Build xfade chain: [0][1]xfade→[v1], [v1][2]xfade→[v2], [v2][3]xfade→[vcross]
    let filter = "";
    let prev   = "0:v";
    for (let i = 1; i < n; i++) {
        const offset = i * stepDur;
        const out    = i === n - 1 ? "vcross" : `v${i}`;
        filter      += `[${prev}][${i}:v]xfade=transition=fade:duration=${FADE_DUR}:offset=${offset}[${out}];`;
        prev         = out;
    }
    // Final global fade in/out
    filter += `[vcross]fade=t=in:st=0:d=0.5,fade=t=out:st=${totalDur - 1.2}:d=1.0[vout]`;

    const cmd = [
        "ffmpeg -y",
        inputs,
        `-i "${musicPath}"`,
        `-filter_complex "${filter}"`,
        `-map "[vout]" -map ${n}:a`,
        `-t ${totalDur}`,
        `-c:v libx264 -preset fast -profile:v baseline -level 3.1 -crf 22 -pix_fmt yuv420p -r 30 -threads 2`,
        `-c:a aac -b:a 128k -ar 44100 -ac 2 -shortest`,
        `-movflags +faststart`,
        `"${videoPath}"`,
    ].join(" ");

    console.log(`   [FFmpeg] Merging ${n} clips with xfade...`);
    console.log(`   [FFmpeg] Filter: ${filter}`);
    const t0 = Date.now();
    try {
        execSync(cmd, { stdio: "pipe", timeout: 300000 });
    } catch (err) {
        const stderr = err.stderr?.toString() || err.stdout?.toString() || "";
        console.error(`   [FFmpeg] Merge failed:\n${stderr.slice(-1000)}`);
        throw new Error(`FFmpeg merge failed: ${stderr.slice(-400)}`);
    }
    console.log(`✅ Final video: ${path.basename(videoPath)} (${totalDur.toFixed(1)}s, ${Date.now() - t0}ms)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function generateMahabharatVideo({ script, epNumber = 1, outputDir = __dirname } = {}) {
    const ts        = Date.now();
    const useGemini = !!process.env.GEMINI_API_KEY;
    const videoPath = path.join(outputDir, `mb_video_${ts}.mp4`);

    const t0Total = Date.now();
    console.log(`\n${"─".repeat(60)}`);
    console.log(`🎬 Mahabharat EP ${epNumber} — ${script.character} [${useGemini ? "Gemini Imagen 3" : "DALL-E 3"}]`);
    console.log(`   outputDir: ${outputDir}`);
    console.log(`   zoom: ${process.env.MAHABHARAT_ZOOM === "true" ? "ON" : "OFF"}`);
    console.log(`${"─".repeat(60)}`);

    // Build 4 scene prompts via Claude (fall back to generic if fails)
    let scenePrompts;
    try {
        scenePrompts = await buildScenePrompts(script);
    } catch (err) {
        console.warn(`   Scene prompts failed (${err.message}) — using generic fallback`);
        const base = `Premium Mahabharat illustration, ${script.character}, dramatic golden lighting, ancient India, Amar Chitra Katha art style, no text, 9:16 portrait`;
        scenePrompts = [base, base, base, base];
    }

    const rawImages  = [];
    const clipPaths  = [];
    let firstImgPath = null;

    for (let i = 0; i < TOTAL_CLIPS; i++) {
        const scene    = SCENES[i];
        const imgPath  = path.join(outputDir, `mb_raw_s${i}_${ts}.png`);
        const compPath = path.join(outputDir, `mb_comp_s${i}_${ts}.jpg`);
        const clipPath = path.join(outputDir, `mb_clip_s${i}_${ts}.mp4`);

        console.log(`\n🔄 Scene ${i + 1}/4 [${scene.section}]`);

        // Generate image — try Gemini first, then DALL-E
        try {
            if (useGemini) {
                await generateGeminiImage(scenePrompts[i], imgPath);
                console.log(`   ✅ Gemini image ${i + 1}`);
            } else {
                await generateDalleImage(scenePrompts[i], imgPath, script.character);
                console.log(`   ✅ DALL-E image ${i + 1}`);
            }
        } catch (err) {
            if (useGemini && process.env.OPENAI_API_KEY) {
                console.warn(`   Gemini failed: ${err.message} — falling back to DALL-E`);
                await generateDalleImage(scenePrompts[i], imgPath, script.character);
                console.log(`   ✅ DALL-E fallback image ${i + 1}`);
            } else {
                throw err;
            }
        }

        if (i === 0) firstImgPath = imgPath; // keep first raw image for Cloudinary/Flow
        rawImages.push(imgPath);

        // Composite text overlay
        await compositeScene(imgPath, i, script, epNumber, compPath);

        // Build video clip
        buildClip(compPath, i, CLIP_DUR, clipPath);
        clipPaths.push(clipPath);

        // Cleanup composite JPEG (raw PNG kept for first image)
        try { fs.unlinkSync(compPath); } catch (_) {}
        if (i > 0) { try { fs.unlinkSync(imgPath); } catch (_) {} }
    }

    // Merge with xfade + music
    const musicPath = pickMusic();
    console.log(`\n🔄 Step 5/5 — Merging + music (${path.basename(musicPath)})...`);

    try {
        mergeClips(clipPaths, musicPath, videoPath);
    } catch (err) {
        // Surface first image so caller can upload as fallback thumbnail
        throw Object.assign(err, { imagePath: firstImgPath });
    } finally {
        clipPaths.forEach(p => { try { fs.unlinkSync(p); } catch (_) {} });
    }

    const elapsed = ((Date.now() - t0Total) / 1000).toFixed(1);
    console.log(`\n🏁 EP ${epNumber} complete in ${elapsed}s → ${path.basename(videoPath)}`);
    console.log("─".repeat(60));

    // Return first scene image as the "thumbnail" for Cloudinary + Google Flow widget
    return { videoPath, imagePath: firstImgPath };
}

module.exports = { generateMahabharatVideo };
