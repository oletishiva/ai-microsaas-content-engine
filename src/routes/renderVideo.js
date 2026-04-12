/**
 * src/routes/renderVideo.js
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/render-video
 *
 * Accepts JSON:
 *   imageUrl   string   — public image URL (Cloudinary / DALL-E)
 *   hook       string   — shown for first 2 seconds (scroll-stopper)
 *   quote      string   — shown for remaining 13 seconds (main message)
 *   language   string   — "english" | "telugu" | "hindi" | "tamil" | "kannada"
 *                         (default: "english")
 *   music      boolean  — add background music (default: true)
 *
 * Returns:
 *   { videoUrl: "https://res.cloudinary.com/..." }
 *
 * Video structure:
 *   0–2s   → hook frame   (large centered text, dark top gradient)
 *   2–15s  → quote frame  (quote text, dark bottom gradient)
 *   xfade  → 0.5s smooth blend between frames
 */

const express      = require("express");
const router       = express.Router();
const path         = require("path");
const fs           = require("fs");
const https        = require("https");
const http         = require("http");
const sharp        = require("sharp");
const { execSync } = require("child_process");

const logger  = require("../../utils/logger");
const { OUTPUT_DIR } = require("../../config/paths");
const { uploadVideoToCloudinary } = require("../services/cloudinaryUploader");

const W = 1080, H = 1920;

// Font selection by language
const FONTS = {
    english:  { file: "Caveat-Bold.ttf",            family: "Caveat",             isLatin: true  },
    telugu:   { file: "NotoSansTelugu.ttf",          family: "Noto Sans Telugu",   isLatin: false },
    hindi:    { file: "NotoSansDevanagari-Bold.ttf", family: "Noto Sans Devanagari", isLatin: false },
    tamil:    { file: "NotoSansTamil-Bold.ttf",        family: "Noto Sans Tamil",   isLatin: false },
    kannada:  { file: "NotoSansKannada-Bold.ttf",     family: "Noto Sans Kannada", isLatin: false },
};

const MUSIC_DIR = path.resolve(__dirname, "../../music");

// ── Helpers ───────────────────────────────────────────────────────────────────

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const get  = url.startsWith("https") ? https.get : http.get;
        get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                file.close(); fs.unlink(dest, () => {});
                return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} downloading image`));
            res.pipe(file);
            file.on("finish", () => { file.close(); resolve(); });
        }).on("error", reject);
    });
}

function escapeXml(str) {
    return String(str)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wrapText(text, maxChars) {
    const words = text.split(" ");
    const lines = []; let cur = "";
    for (const w of words) {
        const c = cur ? `${cur} ${w}` : w;
        if (c.length > maxChars && cur) { lines.push(cur); cur = w; }
        else cur = c;
    }
    if (cur) lines.push(cur);
    return lines;
}

function pickMusic() {
    try {
        const files = fs.readdirSync(MUSIC_DIR).filter(f => /\.(mp3|m4a|wav)$/i.test(f));
        if (!files.length) return null;
        return path.join(MUSIC_DIR, files[Math.floor(Math.random() * files.length)]);
    } catch (_) { return null; }
}

async function renderTextBuf(text, sizePt, color, weight, fontFile, fontFamily, textW) {
    const markup = `<span font_family="${fontFamily}" font_size="${sizePt}pt" font_weight="${weight}" foreground="${color}">${escapeXml(text)}</span>`;
    const buf = await sharp({
        text: { text: markup, fontfile: fontFile, width: textW, rgba: true, dpi: 96, align: "centre" }
    }).png().toBuffer();
    const { width: w, height: h } = await sharp(buf).metadata();
    return { buf, w: w || textW, h: h || 0 };
}

// ── Build a composite JPEG for one frame ─────────────────────────────────────

async function buildFrame(base, text, position, lang, outputPath) {
    const fontDef  = FONTS[lang] || FONTS.english;
    const fontFile = path.resolve(__dirname, "../../fonts", fontDef.file);
    const fontFam  = fontDef.family;
    const TEXT_W   = Math.round(W * 0.82);
    const maxChars = fontDef.isLatin ? 26 : 18;
    const fontSize = fontDef.isLatin ? 58 : 46;

    const composites = [];

    if (position === "top") {
        // Hook frame — dark gradient at top, large centered text
        const topH = 420;
        const topSvg = `<svg width="${W}" height="${topH}" xmlns="http://www.w3.org/2000/svg">
          <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="#000" stop-opacity="0.88"/>
            <stop offset="75%"  stop-color="#000" stop-opacity="0.30"/>
            <stop offset="100%" stop-color="#000" stop-opacity="0"/>
          </linearGradient></defs>
          <rect width="${W}" height="${topH}" fill="url(#g)"/>
        </svg>`;
        composites.push({ input: await sharp(Buffer.from(topSvg)).png().toBuffer(), top: 0, left: 0 });

        // Hook text starts at 12% (safe zone below Shorts chrome)
        let y = Math.floor(H * 0.12);
        for (const line of wrapText(text.trim(), maxChars)) {
            const { buf, w, h } = await renderTextBuf(line, fontSize, "#FFFFFF", "bold", fontFile, fontFam, TEXT_W);
            composites.push({ input: buf, top: y, left: Math.floor((W - w) / 2) });
            y += h + 10;
        }

    } else {
        // Quote frame — dark gradient at bottom, large text
        const botH = Math.floor(H * 0.55);
        const botSvg = `<svg width="${W}" height="${botH}" xmlns="http://www.w3.org/2000/svg">
          <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="#000" stop-opacity="0"/>
            <stop offset="25%"  stop-color="#000" stop-opacity="0.50"/>
            <stop offset="100%" stop-color="#000" stop-opacity="0.92"/>
          </linearGradient></defs>
          <rect width="${W}" height="${botH}" fill="url(#g)"/>
        </svg>`;
        composites.push({ input: await sharp(Buffer.from(botSvg)).png().toBuffer(), top: H - botH, left: 0 });

        let y = H - botH + Math.floor(botH * 0.18);
        for (const line of wrapText(text.trim(), maxChars + 4)) {
            const { buf, w, h } = await renderTextBuf(line, fontDef.isLatin ? 64 : 50, "#FFFFFF", "900", fontFile, fontFam, TEXT_W);
            composites.push({ input: buf, top: y, left: Math.floor((W - w) / 2) });
            y += h + 10;
        }
    }

    await sharp(base).composite(composites).jpeg({ quality: 92 }).toFile(outputPath);
}

// ── POST /api/render-video ────────────────────────────────────────────────────

router.post("/render-video", async (req, res) => {
    const {
        imageUrl,
        hook,
        quote,
        language = "english",
        music    = true,
    } = req.body;

    if (!imageUrl) return res.status(400).json({ error: "imageUrl is required" });
    if (!quote)    return res.status(400).json({ error: "quote is required" });

    const ts         = Date.now();
    const imgPath    = path.join(OUTPUT_DIR, `rv_img_${ts}.jpg`);
    const hookComp   = path.join(OUTPUT_DIR, `rv_hook_${ts}.jpg`);
    const quoteComp  = path.join(OUTPUT_DIR, `rv_quote_${ts}.jpg`);
    const hookClip   = path.join(OUTPUT_DIR, `rv_clip1_${ts}.mp4`);
    const quoteClip  = path.join(OUTPUT_DIR, `rv_clip2_${ts}.mp4`);
    const vidPath    = path.join(OUTPUT_DIR, `rv_vid_${ts}.mp4`);
    const concatList = path.join(OUTPUT_DIR, `rv_list_${ts}.txt`);

    const cleanup = (...files) => files.forEach(f => {
        try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
    });

    const lang = (language || "english").toLowerCase();

    try {
        logger.info("RenderVideo", `lang=${lang} hook="${(hook||"").slice(0,40)}" quote="${(quote||"").slice(0,40)}"`);

        // 1. Download image
        await downloadFile(imageUrl, imgPath);

        // 2. Resize base buffer
        const base = await sharp(imgPath)
            .resize(W, H, { fit: "cover", position: "center" })
            .flatten({ background: "#000" })
            .toBuffer();
        cleanup(imgPath);

        // 3. Build hook frame (if hook provided) + quote frame
        const hasHook = hook && hook.trim().length > 0;
        if (hasHook) {
            await buildFrame(base, hook, "top", lang, hookComp);
        }
        await buildFrame(base, quote, "bottom", lang, quoteComp);

        const musicPath  = (music !== false && music !== "false") ? pickMusic() : null;
        const HOOK_DUR   = hasHook ? 2 : 0;
        const QUOTE_DUR  = 15 - HOOK_DUR;
        const SW = Math.round(W * 1.08), SH = Math.round(H * 1.08);

        const videoFlags = `-c:v libx264 -preset fast -profile:v baseline -level 3.1 -crf 23 -pix_fmt yuv420p -r 30 -threads 2`;

        if (hasHook) {
            // Render hook clip (2s) — with silent audio so concat streams match
            execSync([
                `ffmpeg -y -loop 1 -framerate 30 -t ${HOOK_DUR} -i "${hookComp}" -f lavfi -i anullsrc=r=44100:cl=stereo`,
                `-vf "scale=${SW}:${SH},crop=${W}:${H}:'(${SW}-${W})/2':'(${SH}-${H})/2',fade=t=in:st=0:d=0.5"`,
                `-t ${HOOK_DUR} ${videoFlags} -c:a aac -b:a 128k -ar 44100 -ac 2 -shortest "${hookClip}"`,
            ].join(" "), { stdio: "pipe" });

            // Render quote clip with music (or silent audio)
            if (musicPath) {
                execSync([
                    `ffmpeg -y -loop 1 -framerate 30 -t ${QUOTE_DUR} -i "${quoteComp}" -i "${musicPath}"`,
                    `-vf "scale=${SW}:${SH},crop=${W}:${H}:'(${SW}-${W})*t/${QUOTE_DUR}':'(${SH}-${H})/2',fade=t=out:st=${QUOTE_DUR-1}:d=1"`,
                    `-t ${QUOTE_DUR} ${videoFlags} -c:a aac -b:a 128k -ar 44100 -ac 2 -shortest "${quoteClip}"`,
                ].join(" "), { stdio: "pipe" });
            } else {
                execSync([
                    `ffmpeg -y -loop 1 -framerate 30 -t ${QUOTE_DUR} -i "${quoteComp}" -f lavfi -i anullsrc=r=44100:cl=stereo`,
                    `-vf "scale=${SW}:${SH},crop=${W}:${H}:'(${SW}-${W})*t/${QUOTE_DUR}':'(${SH}-${H})/2',fade=t=out:st=${QUOTE_DUR-1}:d=1"`,
                    `-t ${QUOTE_DUR} ${videoFlags} -c:a aac -b:a 128k -ar 44100 -ac 2 -shortest "${quoteClip}"`,
                ].join(" "), { stdio: "pipe" });
            }

            // Concat hook + quote using demuxer (sequential, no OOM)
            fs.writeFileSync(concatList, `file '${hookClip}'\nfile '${quoteClip}'\n`);
            execSync(
                `ffmpeg -y -f concat -safe 0 -i "${concatList}" -c copy -movflags +faststart "${vidPath}"`,
                { stdio: "pipe" }
            );

        } else {
            // No hook — single quote clip
            const cmd = musicPath
                ? `ffmpeg -y -loop 1 -framerate 30 -i "${quoteComp}" -i "${musicPath}" -vf "scale=${SW}:${SH},crop=${W}:${H}:'(${SW}-${W})*t/15':'(${SH}-${H})/2',fade=t=in:st=0:d=1,fade=t=out:st=14:d=1" -t 15 ${videoFlags} -c:a aac -b:a 128k -ar 44100 -ac 2 -shortest -movflags +faststart "${vidPath}"`
                : `ffmpeg -y -loop 1 -framerate 30 -i "${quoteComp}" -vf "scale=${SW}:${SH},crop=${W}:${H}:'(${SW}-${W})*t/15':'(${SH}-${H})/2',fade=t=in:st=0:d=1,fade=t=out:st=14:d=1" -t 15 ${videoFlags} -an -movflags +faststart "${vidPath}"`;
            execSync(cmd, { stdio: "pipe" });
        }

        cleanup(hookComp, quoteComp, hookClip, quoteClip, concatList);

        // 4. Upload to Cloudinary
        const videoUrl = await uploadVideoToCloudinary(vidPath, `rv_${ts}`);
        cleanup(vidPath);

        logger.info("RenderVideo", `Done: ${videoUrl}`);
        res.json({ videoUrl });

    } catch (err) {
        cleanup(imgPath, hookComp, quoteComp, hookClip, quoteClip, concatList, vidPath);
        logger.error("RenderVideo", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
