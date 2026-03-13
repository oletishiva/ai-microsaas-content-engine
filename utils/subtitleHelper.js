/**
 * utils/subtitleHelper.js
 * ------------------------
 * Splits script into key phrases for subtitle overlay timing.
 */

const VIDEO_DURATION = 15;

/**
 * Split script into 3-4 key phrases for subtitle display
 * @param {string} script - Full script text
 * @returns {Array<{ text: string, start: number, end: number }>}
 */
function getSubtitleSegments(script) {
    if (!script || script.trim() === "") return [];

    // Split by sentence boundaries or commas
    const parts = script
        .replace(/[.!?]/g, (m) => m + "|||")
        .split("|||")
        .map((s) => s.trim())
        .filter(Boolean);

    // Split into 4–5 word chunks (fits within 20% margins, 12 chars/line)
    let segments = [];
    if (parts.length >= 2) {
        segments = parts.flatMap((p) => {
            const w = p.split(/\s+/).filter(Boolean);
            const sz = Math.max(4, Math.min(5, Math.ceil(w.length / 2)));
            const out = [];
            for (let i = 0; i < w.length; i += sz) out.push(w.slice(i, i + sz).join(" "));
            return out;
        });
    } else {
        const words = script.split(/\s+/).filter(Boolean);
        const chunkSize = Math.max(4, Math.min(5, Math.ceil(words.length / 5)));
        for (let i = 0; i < words.length; i += chunkSize) {
            segments.push(words.slice(i, i + chunkSize).join(" "));
        }
    }

    // Limit to 6 segments
    segments = segments.slice(0, 6).filter(Boolean);
    if (segments.length === 0) segments = [script];

    // Assign time slots evenly across 15 seconds
    const durationPerSegment = VIDEO_DURATION / segments.length;
    return segments.map((text, i) => ({
        text: text.trim(),
        start: i * durationPerSegment,
        end: (i + 1) * durationPerSegment,
    }));
}

/**
 * Escape text for FFmpeg drawtext filter (single quotes)
 */
function escapeDrawText(text) {
    return String(text).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

module.exports = { getSubtitleSegments, escapeDrawText, VIDEO_DURATION };
