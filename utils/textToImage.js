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

/** Approximate char width in em units for positioning highlights */
const CHAR_WIDTH_EM = 0.62;  // Increased slightly to accommodate wide Arial Bold chars

/**
 * Create PNG with text (white, black outline). Returns path to saved file.
 * options.videoWidth: use 80% for text area (10% margins). Default 1080.
 * options.maxCharsPerLine: override (hook: 14, quote: 18–22).
 * options.highlight: string[] – phrases to highlight with yellow background.
 */
async function renderTextToImage(text, outputPath, options = {}) {
    const fontSize = options.fontSize || 48;
    const videoWidth = options.videoWidth || DEFAULT_WIDTH;
    const textAreaWidth = Math.floor(videoWidth * TEXT_WIDTH_RATIO);
    const width = videoWidth;
    const highlight = Array.isArray(options.highlight) ? options.highlight : [];
    const charWidthPx = fontSize * CHAR_WIDTH_EM;

    const pixelBasedMax = Math.floor(textAreaWidth / (fontSize * 0.62));
    const maxCharsPerLine = options.maxCharsPerLine != null
        ? Math.min(options.maxCharsPerLine, pixelBasedMax)
        : Math.min(pixelBasedMax, fontSize >= 50 ? 14 : 18);
    const lines = wrapText(String(text).trim() || " ", Math.max(6, maxCharsPerLine));
    const lineHeightPx = fontSize * LINE_HEIGHT;
    const totalHeight = Math.max(220, Math.ceil(lines.length * lineHeightPx) + 80);

    const pad = Math.floor(width * MARGIN_RATIO);
    const textWidth = width - 2 * pad;
    const textCenterX = pad + textWidth / 2;

    const startY = totalHeight / 2 - ((lines.length - 1) * lineHeightPx) / 2 + fontSize * 0.4;

    const rects = [];
    const lowerLine = (l) => String(l).toLowerCase();
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineY = startY + i * lineHeightPx;
        const lineLen = line.length;
        const lineStartX = textCenterX - (lineLen * charWidthPx) / 2;
        for (const phrase of highlight) {
            if (!phrase || !phrase.trim()) continue;
            const p = phrase.trim().toLowerCase();
            let idx = lowerLine(line).indexOf(p);
            if (idx >= 0) {
                const rectX = lineStartX + idx * charWidthPx - 8; // -8px padding left
                const rectW = p.length * charWidthPx + 16;       // +16px total padding
                const rectY = lineY - fontSize * 0.85;
                const rectH = fontSize * 1.15;
                rects.push(`<rect x="${rectX}" y="${rectY}" width="${rectW}" height="${rectH}" fill="#FFEB3B" opacity="0.75"/>`);
            } else {
                for (const word of p.split(/\s+/)) {
                    if (word.length < 2) continue;
                    idx = lowerLine(line).indexOf(word);
                    if (idx >= 0) {
                        const rectX = lineStartX + idx * charWidthPx - 8;
                        const rectW = word.length * charWidthPx + 16;
                        const rectY = lineY - fontSize * 0.85;
                        const rectH = fontSize * 1.15;
                        rects.push(`<rect x="${rectX}" y="${rectY}" width="${rectW}" height="${rectH}" fill="#FFEB3B" opacity="0.75"/>`);
                    }
                }
            }
        }
    }

    const escapedLines = lines.map((l) => escapeXml(l));
    const tspans = escapedLines
        .map(
            (line, i) =>
                `<tspan x="${textCenterX}" dy="${i === 0 ? 0 : lineHeightPx}">${line}</tspan>`
        )
        .join("\n        ");

    const strokeWidth = 2;
    const rectsSvg = rects.join("\n    ");
    
    const isBlackFont = options.textColor === "black";
    const textFill = isBlackFont ? "black" : "white";
    const textStroke = isBlackFont ? "white" : "black";
    
    // IMPORTANT: rectsSvg goes BEFORE text so the yellow highlight sits BEHIND the text
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}" overflow="hidden">
  <defs><clipPath id="textClip"><rect x="0" y="0" width="${width}" height="${totalHeight}"/></clipPath></defs>
  <g clip-path="url(#textClip)">
    ${rectsSvg ? rectsSvg + "\n    " : ""}
    <text x="${textCenterX}" y="${startY}" text-anchor="middle"
          font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700"
          fill="${textFill}" stroke="${textStroke}" stroke-width="${strokeWidth}" paint-order="stroke fill">
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
