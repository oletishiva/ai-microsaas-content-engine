/**
 * utils/textToImage.js
 * --------------------
 * Renders text to PNG using Sharp + SVG.
 * Used for overlay when FFmpeg lacks drawtext.
 */

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const WIDTH = 1080;
const HEIGHT = 200;

function escapeXml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

/**
 * Create PNG with text (white, black outline). Returns path to saved file.
 */
async function renderTextToImage(text, outputPath, options = {}) {
    const fontSize = options.fontSize || 48;
    const maxWidth = options.maxWidth || WIDTH - 80;

    const escaped = escapeXml(String(text).trim() || " ");
    const singleLine = escaped.length > 50 ? escaped.slice(0, 47) + "..." : escaped;
    const totalHeight = HEIGHT;

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${totalHeight}">
  <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)"/>
  <text x="${WIDTH / 2}" y="${totalHeight / 2}" text-anchor="middle" dominant-baseline="middle"
        font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="bold"
        fill="white" stroke="black" stroke-width="3">${singleLine}</text>
</svg>`;

    await sharp(Buffer.from(svg))
        .png()
        .toFile(outputPath);

    return outputPath;
}

module.exports = { renderTextToImage };
