#!/usr/bin/env node
/** npm run doctor – quick check that this computer is ready (Node, FFmpeg, fonts, a real test render). */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { ffmpegSource } = require("../utils/bootstrap");

let bad = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { bad++; console.log(`  ❌ ${m}`); };

console.log("\nAI Content Studio – system check\n");
parseInt(process.versions.node, 10) >= 18 ? ok(`Node ${process.versions.node}`) : fail(`Node ${process.versions.node} is too old – install Node 18+ from https://nodejs.org`);
try { ok(`FFmpeg (${ffmpegSource}): ${execSync("ffmpeg -version").toString().split("\n")[0]}`); } catch (_) { fail("FFmpeg not found – run `npm install` again"); }
try { require("sharp"); ok("Image engine (sharp)"); } catch (e) { fail(`sharp failed to load: ${e.message}`); }
for (const f of ["Caveat-Bold.ttf", "NotoSansTelugu.ttf"]) fs.existsSync(path.join(__dirname, "..", "fonts", f)) ? ok(`Font ${f}`) : fail(`Missing font ${f}`);
const has = (k) => !!process.env[k];
has("ANTHROPIC_API_KEY") || has("OPENAI_API_KEY") ? ok("AI key configured") : console.log("  ⚠️  No AI key yet – add one at http://localhost:3000/settings");

// real render: gradient image → text overlay → mp4
(async () => {
    try {
        const { generateStudioVideo } = require("../studio_video_gen");
        const sharp = require("sharp");
        const out = fs.mkdtempSync(path.join(require("os").tmpdir(), "studio-doctor-"));
        const img = path.join(out, "bg.jpg");
        await sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#2b3a67" } }).jpeg().toFile(img);
        const r = await generateStudioVideo({ mode: "guided", quote: "Doctor check passed", hook: "HELLO", scenes: 1, duration: 15, music: false, localImages: { 0: img }, outputDir: out });
        const size = fs.statSync(r.videoPath).size;
        size > 10000 ? ok(`Test video rendered (${Math.round(size / 1024)} KB)`) : fail("Test video is empty");
        fs.rmSync(out, { recursive: true, force: true });
    } catch (e) { fail(`Test render failed: ${e.message}`); }
    console.log(bad ? `\n${bad} problem(s) found.\n` : "\nAll good. Run start.bat / ./start.sh\n");
    process.exit(bad ? 1 : 0);
})();
