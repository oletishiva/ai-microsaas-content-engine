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

// ── Constants ─────────────────────────────────────────────────────────────────
const W = 1080, H = 1920;
const GOLD  = "#C9A84C";
const WHITE = "#FFFFFF";

const CLIP_DUR    = 7.5;    // seconds per scene (4 × 7.5 = 30s)
const TOTAL_CLIPS = 4;

// Scene → script section mapping
const SCENES = [
    { section: "hook",   label: "",          textColor: WHITE, textSize: 36 },
    { section: "story",  label: "కథ",        textColor: WHITE, textSize: 28 },
    { section: "lesson", label: "నేటి పాఠం", textColor: GOLD,  textSize: 28 },
    { section: "cta",    label: "",          textColor: WHITE, textSize: 34 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function pickMusic() {
    const dir   = path.resolve(__dirname, "music");
    const files = fs.readdirSync(dir).filter(f => /\.(mp3|m4a|wav)$/i.test(f));
    if (!files.length) throw new Error("No audio files in music/ folder");
    return path.join(dir, files[Math.floor(Math.random() * files.length)]);
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
        max_tokens: 2000,
        system: `You are an expert at writing image prompts for Indian mythological art.

Given a Mahabharat short script, write 4 DISTINCT image prompts — one per scene.

Base style for each: Premium Mahabharat illustration, dramatic golden volumetric lighting, ancient India, Amar Chitra Katha meets cinematic concept art, deep saffron sky, royal silk garments, ornate jewelry, no text, no borders, 9:16 portrait orientation

Safety rules (MUST follow):
- Avoid: battle, war, blood, death, kill, weapon, sword, fight, arrow
- Use: confrontation, divine moment, heroic stance, contemplation, revelation

Scene roles:
1. HOOK — dramatic wide establishing shot. Large sky, palace or forest background.
2. STORY — the incident's emotional peak. Character close-up with intense expression.
3. LESSON — symbolic/calm. Soft warm light. Reflective mood.
4. CTA — majestic inspiring pose. Looking toward viewer.

Return ONLY a JSON array of exactly 4 strings. Keep each prompt under 120 words.
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


// ── Step 2b: DALL-E 3 fallback image ──────────────────────────────────────────
// Used only when Gemini fails AND allowDallEFallback=true (cron jobs only — cost control)
async function generateDalleImage(prompt, outputPath) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set — no DALL-E fallback available");
    console.log(`   [DALL-E] Generating fallback image...`);
    const openai = new OpenAI.default({ apiKey });

    async function tryGenerate(p) {
        const response = await openai.images.generate({
            model: "dall-e-3",
            prompt: `${p}. Portrait 9:16 vertical orientation, cinematic quality.`,
            n: 1, size: "1024x1792", quality: "standard",
        });
        await downloadFile(response.data[0].url, outputPath);
    }

    try {
        await tryGenerate(prompt);
    } catch (err) {
        if (err?.status === 400 || err?.message?.includes("safety")) {
            console.log(`   [DALL-E] Safety rejection — retrying with sanitized prompt...`);
            const safe = prompt
                .replace(/\b(war|battle|fight|warrior|soldier|weapon|sword|arrow|spear|blood|death|kill|dead|army|combat|violence|attack|destroy|enemy|defeat)\b/gi, "")
                .replace(/\s{2,}/g, " ").trim();
            const fallback = safe.length > 30
                ? `${safe}, ancient Indian landscape, divine light, symbolic, cinematic`
                : "ancient Indian temple at golden sunset, divine light, lotus flowers, dramatic sky, cinematic";
            await tryGenerate(fallback);
        } else {
            throw err;
        }
    }
    console.log(`   [DALL-E] ✅ fallback image saved`);
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
    const TEXT_W    = Math.round(W * 0.80); // 864px — 80% width, 10% padding each side

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

    // ── BOTTOM dark gradient — covers bottom 55% so all text is readable ─────
    const botGradH = Math.floor(H * 0.55); // 1056px — from mid-screen down
    const botSvg   = `<svg width="${W}" height="${botGradH}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#000" stop-opacity="0"/>
        <stop offset="30%"  stop-color="#000" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0.90"/>
      </linearGradient></defs>
      <rect width="${W}" height="${botGradH}" fill="url(#bg)"/>
    </svg>`;
    composites.push({ input: await sharp(Buffer.from(botSvg)).png().toBuffer(), top: H - botGradH, left: 0 });

    // Section label pill (కథ / నేటి పాఠం) — fixed just above branding
    const BOTTOM_BRAND_H = 60;
    let textTopY = H - botGradH + 80; // text starts from mid-screen

    if (label) {
        const { buf: lblBuf, w: lblW, h: lblH } = await rt(label, 26, GOLD, "bold");
        const pillW = lblW + 60, pillH = lblH + 22;
        const pillSvg = `<svg width="${pillW}" height="${pillH}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${pillW}" height="${pillH}" rx="10" fill="${GOLD}" fill-opacity="0.12"/>
          <rect x="1" y="1" width="${pillW - 2}" height="${pillH - 2}" rx="9" fill="none" stroke="${GOLD}" stroke-width="1.5"/>
        </svg>`;
        composites.push({ input: await sharp(Buffer.from(pillSvg)).png().toBuffer(), top: textTopY, left: Math.floor((W - pillW) / 2) });
        composites.push({ input: lblBuf, top: textTopY + 11, left: Math.floor((W - lblW) / 2) });
        textTopY += pillH + 16;
    }

    // Section text — render all lines top → down, no truncation
    const maxChars = section === "hook" ? 28 : section === "cta" ? 32 : 34;
    const lines    = wrapText(script[section] || "", maxChars);
    const maxBottomY = H - BOTTOM_BRAND_H - 10;
    for (const line of lines) {
        if (textTopY >= maxBottomY) break; // stop if we'd overflow into branding
        const { buf, w: tw, h: th } = await rt(line, textSize, textColor, "bold");
        if (textTopY + th > maxBottomY) break;
        const left = Math.max(0, Math.floor((W - tw) / 2));
        composites.push({ input: buf, top: textTopY, left });
        textTopY += th + 8;
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
// Smooth parallax pan using scale+crop with FFmpeg's 't' variable.
// Much faster and smoother than zoompan (no frame-by-frame stuttering).
// Scale to 1.12× then pan 120px across the clip duration.
// Even scenes pan left→right, odd scenes pan right→left for visual variety.
// Set MAHABHARAT_ZOOM=false to disable (static crop, fastest).
function buildClip(imagePath, sceneIdx, duration, clipPath) {
    const skipZoom = process.env.MAHABHARAT_ZOOM === "false";

    // Scale 12% larger than target so we have room to pan without black bars
    const SW = Math.round(W * 1.12); // 1210
    const SH = Math.round(H * 1.12); // 2150
    const panX = SW - W;             // 130px total travel
    const panY = Math.floor((SH - H) / 2); // centred vertically

    let vf;
    if (!skipZoom) {
        // t-based pan: smooth linear travel across the clip
        const xExpr = sceneIdx % 2 === 0
            ? `${panX}*(t/${duration})`           // left → right
            : `${panX}*(1-t/${duration})`;         // right → left
        vf = `scale=${SW}:${SH},crop=${W}:${H}:'${xExpr}':${panY},`;
    } else {
        vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},`;
    }
    vf += `format=yuv420p`;

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
        execSync(cmd, { stdio: "pipe", timeout: 60000 });
    } catch (err) {
        const stderr = err.stderr?.toString() || err.stdout?.toString() || "";
        console.error(`   [FFmpeg] Clip ${sceneIdx + 1} failed:\n${stderr.slice(-800)}`);
        throw new Error(`FFmpeg clip ${sceneIdx + 1} failed: ${stderr.slice(-300)}`);
    }
    console.log(`   ✅ Clip ${sceneIdx + 1} built (${Date.now() - t0}ms)`);
}

// ── Step 5: concat merge + music ─────────────────────────────────────────────
// Uses concat demuxer (not filter_complex xfade) to avoid loading all 4 streams
// into memory simultaneously — prevents OOM kill on Railway's constrained memory.
// Clips already have smooth pan motion so hard cuts between scenes look fine.
function mergeClips(clipPaths, musicPath, videoPath) {
    const n        = clipPaths.length;
    const totalDur = n * CLIP_DUR; // 30s exact (no xfade overlap)

    // Write a concat list file next to the output
    const concatList = videoPath.replace(/\.mp4$/, "_concat.txt");
    fs.writeFileSync(concatList, clipPaths.map(p => `file '${p}'`).join("\n"));

    const cmd = [
        "ffmpeg -y",
        `-f concat -safe 0 -i "${concatList}"`,
        `-i "${musicPath}"`,
        `-vf "fade=t=in:st=0:d=0.5,fade=t=out:st=${totalDur - 1.2}:d=1.0"`,
        `-map 0:v -map 1:a`,
        `-t ${totalDur}`,
        `-c:v libx264 -preset fast -profile:v baseline -level 3.1 -crf 22 -pix_fmt yuv420p -r 30 -threads 1`,
        `-c:a aac -b:a 128k -ar 44100 -ac 2 -shortest`,
        `-movflags +faststart`,
        `"${videoPath}"`,
    ].join(" ");

    console.log(`   [FFmpeg] Merging ${n} clips with concat...`);
    const t0 = Date.now();
    try {
        execSync(cmd, { stdio: "pipe", timeout: 300000 });
    } catch (err) {
        const stderr = err.stderr?.toString() || err.stdout?.toString() || "";
        console.error(`   [FFmpeg] Merge failed:\n${stderr.slice(-1000)}`);
        throw new Error(`FFmpeg merge failed: ${stderr.slice(-400)}`);
    } finally {
        try { fs.unlinkSync(concatList); } catch (_) {}
    }
    console.log(`✅ Final video: ${path.basename(videoPath)} (${totalDur.toFixed(1)}s, ${Date.now() - t0}ms)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function generateMahabharatVideo({ script, epNumber = 1, outputDir = __dirname, allowDallEFallback = false } = {}) {
    const ts        = Date.now();
    const useGemini = !!process.env.GEMINI_API_KEY;
    const videoPath = path.join(outputDir, `mb_video_${ts}.mp4`);

    const t0Total = Date.now();
    console.log(`\n${"─".repeat(60)}`);
    console.log(`🎬 Mahabharat EP ${epNumber} — ${script.character} [${useGemini ? "Gemini Imagen 3" : "DALL-E 3"}]`);
    console.log(`   outputDir: ${outputDir}`);
    console.log(`   zoom: ${process.env.MAHABHARAT_ZOOM === "false" ? "OFF" : "ON (Ken Burns)"}`);
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

    const rawImages   = [];
    const clipPaths   = [];
    let firstImgPath  = null;
    let firstCompPath = null; // scene-0 composite (background + text overlay) — for WhatsApp sharing

    for (let i = 0; i < TOTAL_CLIPS; i++) {
        const scene    = SCENES[i];
        const imgPath  = path.join(outputDir, `mb_raw_s${i}_${ts}.png`);
        const compPath = path.join(outputDir, `mb_comp_s${i}_${ts}.jpg`);
        const clipPath = path.join(outputDir, `mb_clip_s${i}_${ts}.mp4`);

        console.log(`\n🔄 Scene ${i + 1}/4 [${scene.section}]`);

        // Image generation: Gemini primary, DALL-E fallback (cron only — cost control)
        if (useGemini) {
            try {
                await generateGeminiImage(scenePrompts[i], imgPath);
                console.log(`   ✅ Gemini image ${i + 1}`);
            } catch (geminiErr) {
                if (allowDallEFallback) {
                    console.warn(`   [Gemini] Failed (${geminiErr.message}) — falling back to DALL-E`);
                    await generateDalleImage(scenePrompts[i], imgPath);
                } else {
                    throw geminiErr;
                }
            }
        } else if (allowDallEFallback) {
            console.log(`   GEMINI_API_KEY not set — using DALL-E fallback`);
            await generateDalleImage(scenePrompts[i], imgPath);
        } else {
            throw new Error("GEMINI_API_KEY not set — use the manual image flow");
        }

        if (i === 0) firstImgPath = imgPath; // keep first raw image for Cloudinary/Flow
        rawImages.push(imgPath);

        // Composite text overlay
        await compositeScene(imgPath, i, script, epNumber, compPath);

        // Keep scene-0 composite (background + text) for WhatsApp sharing
        if (i === 0) firstCompPath = compPath;

        // Build video clip
        buildClip(compPath, i, CLIP_DUR, clipPath);
        clipPaths.push(clipPath);

        // Cleanup composite JPEG — except scene 0 (returned to caller for sharing)
        if (i > 0) { try { fs.unlinkSync(compPath); } catch (_) {} }
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

    // Return both raw image (for Google Flow) and composited image (for WhatsApp sharing)
    return { videoPath, imagePath: firstImgPath, compositeImagePath: firstCompPath };
}

// ── Build video from pre-supplied local image paths ───────────────────────────
// Used by the manual-image flow: user generates images in Gemini Studio, uploads
// them via the UI, backend calls this with the 4 saved paths.
async function generateMahabharatVideoFromImages({ script, epNumber = 1, outputDir = __dirname, imagePaths } = {}) {
    if (!Array.isArray(imagePaths) || imagePaths.length < 4) {
        throw new Error("imagePaths must be an array of 4 file paths");
    }

    const ts        = Date.now();
    const videoPath = path.join(outputDir, `mb_video_${ts}.mp4`);
    const t0Total   = Date.now();

    console.log(`\n${"─".repeat(60)}`);
    console.log(`🎬 Mahabharat EP ${epNumber} — ${script.character} [Manual Images]`);
    console.log(`${"─".repeat(60)}`);

    const clipPaths    = [];
    const firstImgPath = imagePaths[0];

    for (let i = 0; i < TOTAL_CLIPS; i++) {
        const scene    = SCENES[i];
        const imgPath  = imagePaths[i];
        const compPath = path.join(outputDir, `mb_comp_${ts}_${i}.jpg`);
        const clipPath = path.join(outputDir, `mb_clip_${ts}_${i}.mp4`);

        console.log(`\n🔄 Scene ${i + 1}/${TOTAL_CLIPS} [${scene.section}]`);
        await compositeScene(imgPath, i, script, epNumber, compPath);
        buildClip(compPath, i, CLIP_DUR, clipPath);
        clipPaths.push(clipPath);
        try { fs.unlinkSync(compPath); } catch (_) {}
    }

    const musicPath = pickMusic();
    console.log(`\n🔄 Merging + music (${path.basename(musicPath)})...`);

    try {
        mergeClips(clipPaths, musicPath, videoPath);
    } finally {
        clipPaths.forEach(p => { try { fs.unlinkSync(p); } catch (_) {} });
    }

    const elapsed = ((Date.now() - t0Total) / 1000).toFixed(1);
    console.log(`\n🏁 EP ${epNumber} complete in ${elapsed}s → ${path.basename(videoPath)}`);
    console.log("─".repeat(60));

    return { videoPath, imagePath: firstImgPath };
}

module.exports = { generateMahabharatVideo, generateMahabharatVideoFromImages, buildScenePrompts };
