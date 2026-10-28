#!/usr/bin/env node
/** node scripts/make-demos.js – renders sample videos (no API keys; procedural backgrounds) into ./demo */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
require("../utils/bootstrap");
const { generateStudioVideo } = require("../studio_video_gen");

const OUT = path.join(__dirname, "..", "demo");
fs.mkdirSync(OUT, { recursive: true });

function bg(file, c1, c2, c3, seed) {
    const r = (n) => Math.abs(Math.sin(seed * 12.9898 + n) * 43758.5453) % 1;
    const blobs = [0, 1, 2, 3].map((i) =>
        `<circle cx="${r(i) * 1080}" cy="${r(i + 9) * 1920}" r="${300 + r(i + 4) * 350}" fill="${i % 2 ? c3 : c2}" opacity="0.45"/>`).join("");
    const svg = `<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg"><defs>
      <linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="#05060f"/></linearGradient>
      <filter id="b"><feGaussianBlur stdDeviation="120"/></filter></defs>
      <rect width="1080" height="1920" fill="url(#g)"/><g filter="url(#b)">${blobs}</g></svg>`;
    return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toFile(file);
}

const DEMOS = [
    { name: "demo-english-vertical", language: "english", hook: "STOP SCROLLING", quote: "Small steps every day build a life you are proud of", subtext: "Progress over perfection.", palette: [["#1d3b72", "#7c3aed", "#38bdf8"], ["#4a1d5e", "#f472b6", "#fbbf24"], ["#0f4c4a", "#34d399", "#60a5fa"]] },
    { name: "demo-telugu-vertical", language: "telugu", hook: "ఈ రోజు మొదలు పెట్టండి", quote: "కష్టపడి పనిచేస్తే విజయం మీ వెంటే వస్తుంది", subtext: "నమ్మకంతో ముందుకు సాగండి", palette: [["#5a2a0a", "#f59e0b", "#ef4444"], ["#3b1f5c", "#fb923c", "#facc15"]] },
    { name: "demo-hindi-vertical", language: "hindi", hook: "रुकिए मत", quote: "हर सुबह एक नया मौका लेकर आती है", subtext: "आज ही शुरुआत करें", palette: [["#0b3d3a", "#22d3ee", "#a3e635"], ["#14284b", "#818cf8", "#f472b6"]] },
    { name: "demo-tamil-vertical", language: "tamil", hook: "இன்றே தொடங்குங்கள்", quote: "முயற்சி செய்தால் வெற்றி உங்களைத் தேடி வரும்", subtext: "நம்பிக்கையுடன் முன்னேறுங்கள்", palette: [["#102a43", "#fb7185", "#fbbf24"], ["#2d1b4e", "#38bdf8", "#a78bfa"]] },
];

(async () => {
    for (const [i, d] of DEMOS.entries()) {
        const work = fs.mkdtempSync(path.join(require("os").tmpdir(), "demo-"));
        const localImages = {};
        for (const [j, p] of d.palette.entries()) {
            const f = path.join(work, `bg${j}.jpg`);
            await bg(f, p[0], p[1], p[2], i * 7 + j + 1);
            localImages[j] = f;
        }
        const r = await generateStudioVideo({ mode: "guided", language: d.language, hook: d.hook, quote: d.quote, subtext: d.subtext, scenes: d.palette.length, duration: 15, music: true, localImages, outputDir: work });
        fs.copyFileSync(r.videoPath, path.join(OUT, `${d.name}.mp4`));
        fs.copyFileSync(r.compositeImagePath, path.join(OUT, `${d.name}.jpg`));
        fs.rmSync(work, { recursive: true, force: true });
        console.log("saved", d.name);
    }
})().catch((e) => { console.error(e); process.exit(1); });
