/**
 * utils/textToImage.js
 * --------------------
 * Renders text to PNG using Sharp + SVG.
 * Used for overlay when FFmpeg lacks drawtext.
 * Text uses 80% width (10% margins) to avoid truncation.
 */

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const DEFAULT_WIDTH = 1080;
const MARGIN_RATIO = 0.1; // 10% left and right
const TEXT_WIDTH_RATIO = 0.8; // 80% for text
const LINE_HEIGHT = 1.2;
// Conservative chars per line for proportional fonts (Arial). ~0.55em avg char width.
const CHARS_PER_EM = 0.55;

function escapeXml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

/**
 * Wrap text into lines that fit within text area.
 * Uses pixel-based estimate: maxChars = textAreaWidth / (fontSize * charsPerEm)
 */
function wrapText(text, maxCharsPerLine) {
    const words = String(text).trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [" "];
    const lines = [];
    let current = "";
    for (const w of words) {
        const next = current ? `${current} ${w}` : w;
        if (next.length <= maxCharsPerLine) {
            current = next;
        } else {
            if (current) lines.push(current);
            // Break long words that exceed line width
            current = w;
            while (current.length > maxCharsPerLine) {
                lines.push(current.slice(0, maxCharsPerLine));
                current = current.slice(maxCharsPerLine);
            }
        }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [" "];
}

/**
 * Create PNG with text (white, black outline). Returns path to saved file.
 * options.videoWidth: use 80% for text area (10% margins). Default 1080.
 */
async function renderTextToImage(text, outputPath, options = {}) {
    const fontSize = options.fontSize || 48;
    const videoWidth = options.videoWidth || DEFAULT_WIDTH;
    const textAreaWidth = Math.floor(videoWidth * TEXT_WIDTH_RATIO);
    const width = videoWidth;
    // Pixel-based wrap: chars that fit = width / (fontSize * avgCharWidth)
    const maxCharsPerLine = Math.floor(textAreaWidth / (fontSize * CHARS_PER_EM));
    const lines = wrapText(String(text).trim() || " ", Math.max(12, maxCharsPerLine));
    const lineHeightPx = fontSize * LINE_HEIGHT;
    const totalHeight = Math.max(200, Math.ceil(lines.length * lineHeightPx) + 40);

    const escapedLines = lines.map((l) => escapeXml(l));
    const tspans = escapedLines
        .map(
            (line, i) =>
                `<tspan x="${width / 2}" dy="${i === 0 ? 0 : lineHeightPx}">${line}</tspan>`
        )
        .join("\n        ");

    const startY = totalHeight / 2 - ((lines.length - 1) * lineHeightPx) / 2 + fontSize * 0.4;

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}">
  <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)"/>
  <text x="${width / 2}" y="${startY}" text-anchor="middle"
        font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="bold"
        fill="white" stroke="black" stroke-width="3">
        ${tspans}
  </text>
</svg>`;

    await sharp(Buffer.from(svg))
        .png()
        .toFile(outputPath);

    return outputPath;
}

module.exports = { renderTextToImage };
