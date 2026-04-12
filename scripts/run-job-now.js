/**
 * scripts/run-job-now.js
 * -----------------------
 * Immediately fires one scheduled job — identical to what the cron does.
 * Music-only (no TTS). Uploads to YouTube if credentials are configured.
 *
 * Usage:
 *   node scripts/run-job-now.js                   → runs "Motivation" slot
 *   node scripts/run-job-now.js "Night Calm"       → runs a specific slot
 */

require("dotenv").config();

const { runScheduledJob } = require("../src/services/scheduler");

const label = process.argv[2] || "Motivation";

const TOPICS = {
    "Motivation":      "daily morning motivation",
    "Affirmation":     "positive daily affirmation",
    "Success Mindset": "success mindset winning habits",
    "Productivity":    "productivity focus deep work",
    "Life Reflection": "life lessons wisdom reflection",
    "Night Calm":      "night calm mindfulness peace",
};

const topic = TOPICS[label];
if (!topic) {
    console.error(`Unknown label: "${label}". Choose from:\n  ${Object.keys(TOPICS).join("\n  ")}`);
    process.exit(1);
}

console.log(`\n▶ Running job: ${label} — "${topic}"\n`);
runScheduledJob({ label, topic }).then(() => {
    console.log("\n✅ Job finished.");
}).catch((err) => {
    console.error("\n❌ Job failed:", err.message);
    process.exit(1);
});
