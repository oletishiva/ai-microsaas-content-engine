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
const MARGIN_RATIO = 0.1; // 10% left and right – 80% width for text
const TEXT_WIDTH_RATIO = 1 - 2 * MARGIN_RATIO; // 80% for text
const LINE_HEIGHT = 1.3;
const CHARS_PER_EM = 0.65; // Wide-char assumption for caps and proportional fonts

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
    // With 80% width, allow more chars per line for fewer, longer lines
    const maxCharsPerLine = Math.floor(textAreaWidth / (fontSize * CHARS_PER_EM));
    const cap = fontSize >= 50 ? 14 : 22; // hook: 14, quote: 22 chars per line
    const lines = wrapText(String(text).trim() || " ", Math.max(6, Math.min(maxCharsPerLine, cap)));
    const lineHeightPx = fontSize * LINE_HEIGHT;
    const totalHeight = Math.max(220, Math.ceil(lines.length * lineHeightPx) + 60);

    const pad = Math.floor(width * MARGIN_RATIO);
    const textWidth = width - 2 * pad;
    const textCenterX = pad + textWidth / 2;

    const escapedLines = lines.map((l) => escapeXml(l));
    const tspans = escapedLines
        .map(
            (line, i) =>
                `<tspan x="${textCenterX}" dy="${i === 0 ? 0 : lineHeightPx}">${line}</tspan>`
        )
        .join("\n        ");

    const startY = totalHeight / 2 - ((lines.length - 1) * lineHeightPx) / 2 + fontSize * 0.4;

    // Stroke 3px for visibility on light backgrounds (ocean/sky); paint-order keeps edges crisp
    const strokeWidth = 3;
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}" overflow="hidden">
  <defs><clipPath id="textClip"><rect x="${pad}" y="0" width="${textWidth}" height="${totalHeight}"/></clipPath></defs>
  <g clip-path="url(#textClip)">
    <text x="${textCenterX}" y="${startY}" text-anchor="middle"
          font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="900"
          fill="white" stroke="black" stroke-width="${strokeWidth}" paint-order="stroke fill">
          ${tspans}
    </text>
  </g>
</svg>`;

    await sharp(Buffer.from(svg))
        .png()
        .toFile(outputPath);

    return outputPath;
}

module.exports = { renderTextToImage };
