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

    // If too few parts, split by ~8 words
    let segments = [];
    if (parts.length >= 2) {
        segments = parts;
    } else {
        const words = script.split(/\s+/);
        const chunkSize = Math.max(1, Math.ceil(words.length / 3));
        for (let i = 0; i < words.length; i += chunkSize) {
            segments.push(words.slice(i, i + chunkSize).join(" "));
        }
    }

    // Limit to 4 segments max
    segments = segments.slice(0, 4).filter(Boolean);
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
