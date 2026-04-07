/**
 * src/routes/renderVideo.js
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/render-video
 *
 * Accepts JSON:
 *   imageUrl   string  — Cloudinary or any public image URL (DALL-E URL works too)
 *   hook       string  — short scroll-stopping line (shown at top)
 *   quote      string  — main message (shown at bottom)
 *   music      boolean — add background music (default: true)
 *
 * Returns:
 *   { videoUrl: "https://res.cloudinary.com/..." }
 *
 * Used by n8n workflow to replace Shotstack.
 * Synchronous — n8n waits for response (set HTTP node timeout to 180s).
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
const FONT = path.resolve(__dirname, "../../fonts/Caveat-Bold.ttf");
const MUSIC_DIR = path.resolve(__dirname, "../../music");

// ── Helpers ───────────────────────────────────────────────────────────────────

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const get  = url.startsWith("https") ? https.get : http.get;
        get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                file.close();
                fs.unlink(dest, () => {});
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
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function wrapText(text, maxChars) {
    const words = text.split(" ");
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

function pickMusic() {
    try {
        const files = fs.readdirSync(MUSIC_DIR).filter(f => /\.(mp3|m4a|wav)$/i.test(f));
        if (files.length === 0) return null;
        return path.join(MUSIC_DIR, files[Math.floor(Math.random() * files.length)]);
    } catch (_) { return null; }
}

async function renderText(text, sizePt, color, weight) {
    const markup = `<span font_family="Caveat" font_size="${sizePt}pt" font_weight="${weight}" foreground="${color}">${escapeXml(text)}</span>`;
    const buf = await sharp({
        text: { text: markup, fontfile: FONT, width: Math.round(W * 0.82), rgba: true, dpi: 96, align: "centre" }
    }).png().toBuffer();
    const { width: w, height: h } = await sharp(buf).metadata();
    return { buf, w: w || Math.round(W * 0.82), h: h || 0 };
}

// ── POST /api/render-video ────────────────────────────────────────────────────

router.post("/render-video", async (req, res) => {
    const { imageUrl, hook, quote, music = true } = req.body;

    if (!imageUrl) return res.status(400).json({ error: "imageUrl is required" });
    if (!quote)    return res.status(400).json({ error: "quote is required" });

    const ts       = Date.now();
    const imgPath  = path.join(OUTPUT_DIR, `rv_img_${ts}.jpg`);
    const compPath = path.join(OUTPUT_DIR, `rv_comp_${ts}.jpg`);
    const vidPath  = path.join(OUTPUT_DIR, `rv_vid_${ts}.mp4`);

    const cleanup = (...files) => files.forEach(f => { try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {} });

    try {
        logger.info("RenderVideo", `hook="${(hook||"").slice(0,40)}" quote="${(quote||"").slice(0,40)}"`);

        // 1. Download background image
        await downloadFile(imageUrl, imgPath);

        // 2. Resize base
        const base = await sharp(imgPath)
            .resize(W, H, { fit: "cover", position: "center" })
            .flatten({ background: "#000" })
            .toBuffer();

        const composites = [];

        // 3. Top dark gradient (covers hook area)
        const topH = 340;
        const topSvg = `<svg width="${W}" height="${topH}" xmlns="http://www.w3.org/2000/svg">
          <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="#000" stop-opacity="0.88"/>
            <stop offset="70%"  stop-color="#000" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#000" stop-opacity="0"/>
          </linearGradient></defs>
          <rect width="${W}" height="${topH}" fill="url(#tg)"/>
        </svg>`;
        composites.push({ input: await sharp(Buffer.from(topSvg)).png().toBuffer(), top: 0, left: 0 });

        // 4. Hook text — top, 12% from top (safe zone below Shorts chrome)
        if (hook && hook.trim()) {
            let hookY = Math.floor(H * 0.12);
            for (const line of wrapText(hook.trim(), 26)) {
                const { buf, w, h } = await renderText(line, 52, "#FFFFFF", "bold");
                composites.push({ input: buf, top: hookY, left: Math.floor((W - w) / 2) });
                hookY += h + 8;
            }
        }

        // 5. Bottom dark gradient (covers quote area)
        const botH = Math.floor(H * 0.52);
        const botSvg = `<svg width="${W}" height="${botH}" xmlns="http://www.w3.org/2000/svg">
          <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="#000" stop-opacity="0"/>
            <stop offset="28%"  stop-color="#000" stop-opacity="0.52"/>
            <stop offset="100%" stop-color="#000" stop-opacity="0.92"/>
          </linearGradient></defs>
          <rect width="${W}" height="${botH}" fill="url(#bg)"/>
        </svg>`;
        composites.push({ input: await sharp(Buffer.from(botSvg)).png().toBuffer(), top: H - botH, left: 0 });

        // 6. Quote text — large, bottom section
        let textY = H - botH + Math.floor(botH * 0.18);
        for (const line of wrapText(quote.trim(), 28)) {
            const { buf, w, h } = await renderText(line, 64, "#FFFFFF", "900");
            composites.push({ input: buf, top: textY, left: Math.floor((W - w) / 2) });
            textY += h + 10;
        }

        // 7. Composite → JPEG
        await sharp(base).composite(composites).jpeg({ quality: 92 }).toFile(compPath);
        cleanup(imgPath);

        // 8. FFmpeg — Ken Burns pan + optional music
        const DURATION = 15;
        const SW = Math.round(W * 1.08);
        const SH = Math.round(H * 1.08);
        const musicPath = music !== false && music !== "false" ? pickMusic() : null;

        let cmd;
        if (musicPath) {
            cmd = [
                `ffmpeg -y`,
                `-loop 1 -framerate 30 -i "${compPath}"`,
                `-i "${musicPath}"`,
                `-vf "scale=${SW}:${SH},crop=${W}:${H}:'(${SW}-${W})*t/${DURATION}':'(${SH}-${H})/2',fade=t=in:st=0:d=1,fade=t=out:st=${DURATION-1}:d=1"`,
                `-t ${DURATION}`,
                `-c:v libx264 -preset fast -profile:v baseline -level 3.1 -crf 23 -pix_fmt yuv420p -r 30 -threads 2`,
                `-c:a aac -b:a 128k -ar 44100 -ac 2 -shortest`,
                `-movflags +faststart`,
                `"${vidPath}"`,
            ].join(" ");
        } else {
            cmd = [
                `ffmpeg -y`,
                `-loop 1 -framerate 30 -i "${compPath}"`,
                `-vf "scale=${SW}:${SH},crop=${W}:${H}:'(${SW}-${W})*t/${DURATION}':'(${SH}-${H})/2',fade=t=in:st=0:d=1,fade=t=out:st=${DURATION-1}:d=1"`,
                `-t ${DURATION}`,
                `-c:v libx264 -preset fast -profile:v baseline -level 3.1 -crf 23 -pix_fmt yuv420p -r 30 -threads 2`,
                `-an -movflags +faststart`,
                `"${vidPath}"`,
            ].join(" ");
        }

        execSync(cmd, { stdio: "pipe" });
        cleanup(compPath);

        // 9. Upload to Cloudinary
        const videoUrl = await uploadVideoToCloudinary(vidPath, `rv_${ts}`);
        cleanup(vidPath);

        logger.info("RenderVideo", `Done: ${videoUrl}`);
        res.json({ videoUrl });

    } catch (err) {
        cleanup(imgPath, compPath, vidPath);
        logger.error("RenderVideo", err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
