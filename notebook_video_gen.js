/**
 * notebook_video_gen.js
 * ─────────────────────
 * English motivational Shorts — notebook/journal aesthetic.
 * Same background every video (brand recognition).
 * Handwriting font (Caveat Bold) — personal, not corporate.
 *
 * Pipeline:
 *   1. Ensure notebook background exists (generate via DALL-E once, cache forever)
 *   2. Render quote text over the notebook with sharp + Pango
 *   3. FFmpeg: image → 30s video + background music
 */

"use strict";

const path      = require("path");
const fs        = require("fs");
const https     = require("https");
const http      = require("http");
const sharp     = require("sharp");
const { execSync } = require("child_process");
const OpenAI    = require("openai");

const W = 1080;
const H = 1920;
const DURATION = 30;

const FONT_PATH   = path.resolve(__dirname, "fonts", "Caveat-Bold.ttf");
const BG_PATH     = path.resolve(__dirname, "images", "notebook_bg.jpg");
const MUSIC_DIR   = path.resolve(__dirname, "music");

// ── Helpers ───────────────────────────────────────────────────────────────────

function pickMusic() {
    if (!fs.existsSync(MUSIC_DIR)) return null;
    const tracks = fs.readdirSync(MUSIC_DIR).filter(f => /\.(mp3|m4a|wav)$/i.test(f));
    if (!tracks.length) return null;
    return path.join(MUSIC_DIR, tracks[Math.floor(Math.random() * tracks.length)]);
}

function escapeXml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const get  = url.startsWith("https") ? https.get : http.get;
        get(url, res => {
            if (res.statusCode === 301 || res.statusCode === 302)
                return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            if (res.statusCode !== 200)
                return reject(new Error(`HTTP ${res.statusCode}`));
            res.pipe(file);
            file.on("finish", () => { file.close(); resolve(); });
        }).on("error", reject);
    });
}

// ── Step 1: Ensure notebook background exists ─────────────────────────────────
// Generated once via DALL-E 3 and cached as images/notebook_bg.jpg.
// If the file already exists, this is a no-op.
async function ensureBackground() {
    if (fs.existsSync(BG_PATH)) return;

    console.log("🎨 Generating notebook background (one-time setup)...");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = `A beautiful clean aesthetic photo for a motivational quotes social media channel.
A open cream/ivory notebook or journal lying flat, slightly angled, on soft white cotton bedsheets.
Warm natural window light from the side. Minimalist, cozy, aesthetic.
The notebook pages are blank and cream-colored — ready for text.
Portrait orientation 9:16. Photorealistic, soft bokeh background, warm tones.
No text, no people, no hands. Clean and simple.`;

    const response = await openai.images.generate({
        model:   "dall-e-3",
        prompt,
        size:    "1024x1792",
        quality: "hd",
        n:       1,
    });

    const url = response.data[0].url;
    const tmpPath = BG_PATH.replace(".jpg", "_tmp.png");
    await downloadFile(url, tmpPath);

    // Convert + resize to exact 1080×1920 JPEG
    await sharp(tmpPath)
        .resize(W, H, { fit: "cover", position: "center" })
        .jpeg({ quality: 93 })
        .toFile(BG_PATH);

    try { fs.unlinkSync(tmpPath); } catch (_) {}
    console.log("✅ Notebook background saved: images/notebook_bg.jpg");
}

// ── Step 2: Render quote text onto notebook ───────────────────────────────────
async function compositeFrame(quote, channelName) {
    const baseBuffer = await sharp(BG_PATH)
        .resize(W, H, { fit: "cover", position: "center" })
        .toBuffer();

    const composites = [];

    // Subtle warm overlay to ensure text area is readable
    const overlayBuf = await sharp({
        create: { width: W, height: H, channels: 4, background: { r: 255, g: 248, b: 235, alpha: 0.18 } },
    }).png().toBuffer();
    composites.push({ input: overlayBuf, top: 0, left: 0 });

    // Helper: render Caveat text
    async function caveatText(text, sizePt, color, maxW, align = "centre") {
        const w      = maxW || W - 160;
        const markup = `<span font_family="Caveat" font_size="${sizePt}pt" font_weight="bold" foreground="${color}">${escapeXml(text)}</span>`;
        const buf    = await sharp({
            text: { text: markup, fontfile: FONT_PATH, width: w, rgba: true, dpi: 96, align },
        }).png().toBuffer();
        const { width: rw, height: rh } = await sharp(buf).metadata();
        return { buf, w: rw || w, h: rh || 0 };
    }

    // Opening quote mark  "
    const { buf: openBuf, h: openH } = await caveatText("\u201C", 120, "#8B7355", W - 160);
    composites.push({
        input: openBuf,
        top:   Math.floor(H * 0.22),
        left:  Math.floor((W - (W - 160)) / 2),
    });

    // Main quote — centered, dark ink color
    const { buf: quoteBuf, h: quoteH } = await caveatText(quote, 62, "#1C1410", W - 160);
    const quoteTop = Math.floor(H * 0.22) + openH + 10;
    composites.push({
        input: quoteBuf,
        top:   quoteTop,
        left:  Math.floor((W - (W - 160)) / 2),
    });

    // Closing quote mark  "
    const { buf: closeBuf } = await caveatText("\u201D", 120, "#8B7355", W - 160);
    composites.push({
        input: closeBuf,
        top:   quoteTop + quoteH + 4,
        left:  Math.floor((W - (W - 160)) / 2),
    });

    // Thin divider line
    const divW = 120;
    const divBuf = await sharp({
        create: { width: divW, height: 2, channels: 4, background: { r: 139, g: 115, b: 85, alpha: 0.6 } },
    }).png().toBuffer();
    composites.push({
        input: divBuf,
        top:   quoteTop + quoteH + 80,
        left:  Math.floor((W - divW) / 2),
    });

    // Channel name watermark — bottom center
    const { buf: chanBuf } = await caveatText(channelName || "Motivational quotes", 36, "#8B7355");
    composites.push({
        input: chanBuf,
        top:   H - 110,
        left:  Math.floor((W - (W - 160)) / 2),
    });

    return sharp(baseBuffer).composite(composites).jpeg({ quality: 92 }).toBuffer();
}

// ── Step 3: Generate 30s video ────────────────────────────────────────────────
async function generateNotebookVideo({ quote, channelName = "Motivational quotes", outputDir, outputName }) {
    await ensureBackground();

    const ts         = Date.now();
    const framePath  = path.join(outputDir, `nb_frame_${ts}.jpg`);
    const videoPath  = path.join(outputDir, outputName || `nb_video_${ts}.mp4`);

    // Render frame
    const frameBuf = await compositeFrame(quote, channelName);
    await sharp(frameBuf).jpeg({ quality: 92 }).toFile(framePath);

    // FFmpeg: static image → 30s video + music
    const musicPath = pickMusic();
    const audioArgs = musicPath
        ? `-i "${musicPath}" -c:a aac -b:a 128k -ar 44100 -ac 2 -shortest`
        : `-f lavfi -i anullsrc=r=44100:cl=stereo -c:a aac -b:a 128k -ar 44100 -ac 2`;

    const cmd = [
        "ffmpeg -y",
        `-loop 1 -framerate 30 -i "${framePath}"`,
        musicPath ? `-i "${musicPath}"` : `-f lavfi -i anullsrc=r=44100:cl=stereo`,
        `-vf "scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fade=t=in:st=0:d=1,fade=t=out:st=${DURATION - 1}:d=1"`,
        `-t ${DURATION}`,
        `-c:v libx264 -preset fast -profile:v baseline -level 3.1 -crf 23 -pix_fmt yuv420p -r 30 -threads 2`,
        `-c:a aac -b:a 128k -ar 44100 -ac 2 -shortest`,
        `-movflags +faststart`,
        `"${videoPath}"`,
    ].join(" ");

    execSync(cmd, { stdio: "pipe" });
    try { fs.unlinkSync(framePath); } catch (_) {}

    console.log(`✅ Notebook video created: ${path.basename(videoPath)}`);
    return videoPath;
}

module.exports = { generateNotebookVideo, ensureBackground };
