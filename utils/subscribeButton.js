/**
 * utils/subscribeButton.js
 * ------------------------
 * Renders an eye-catching YouTube-style Subscribe button as a transparent PNG
 * using SVG + Sharp. Designed to appear at the bottom of the video frame
 * (15% from the bottom) to attract viewer subscriptions.
 *
 * Design features:
 *  - YouTube-red (#FF0000) pill-shaped button
 *  - Bell emoji + bold "SUBSCRIBE" text in white
 *  - Animated-look glow effect via SVG feDropShadow filter
 *  - Subtle gradient highlight overlay for 3D/premium feel
 *  - Pulsing ring animation (static frame, simulated with concentric arcs)
 */

const sharp = require("sharp");
const path  = require("path");

/**
 * renderSubscribeButton
 * ---------------------
 * Renders the subscribe button PNG to `outputPath`.
 *
 * @param {string} outputPath  - Absolute path for the output PNG file
 * @param {object} [options]
 * @param {number} [options.videoWidth=1080]  - Video width in pixels (for scaling)
 * @returns {Promise<string>} outputPath
 */
async function renderSubscribeButton(outputPath, options = {}) {
    const videoWidth = options.videoWidth || 1080;

    // --- Layout constants (scale with video width) -------------------------
    const scale      = videoWidth / 1080;
    const btnW       = Math.round(520 * scale);   // button pill width
    const btnH       = Math.round(110 * scale);   // button pill height
    const radius     = Math.round(btnH / 2);      // full pill radius
    const fontSize   = Math.round(48 * scale);    // "SUBSCRIBE" font size
    const bellSize   = Math.round(52 * scale);    // bell emoji size
    const glowBlur   = Math.round(28 * scale);    // glow feDropShadow stdDeviation
    const glowR      = Math.round(18 * scale);    // outer glow ring radius offset

    // Canvas is wider / taller than the button to accommodate the glow halo
    const canvasW    = btnW + glowR * 2 + 40 * scale;
    const canvasH    = btnH + glowR * 2 + 40 * scale;
    const btnX       = (canvasW - btnW) / 2;
    const btnY       = (canvasH - btnH) / 2;
    const cx         = btnX + radius;         // bell column x
    const textX      = btnX + radius * 2 + 10 * scale; // text start x
    const textY      = btnY + btnH / 2 + fontSize * 0.35; // text baseline y
    const bellY      = btnY + btnH / 2 + bellSize * 0.35; // bell baseline y

    // Gradient stop y positions
    const gradY1     = btnY;
    const gradY2     = btnY + btnH * 0.45;

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg"
     width="${Math.ceil(canvasW)}" height="${Math.ceil(canvasH)}"
     viewBox="0 0 ${Math.ceil(canvasW)} ${Math.ceil(canvasH)}">
  <defs>
    <!-- Outer glow filter -->
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="0" stdDeviation="${glowBlur * 0.5}"
                    flood-color="#FF0000" flood-opacity="0.90"/>
      <feDropShadow dx="0" dy="0" stdDeviation="${glowBlur}"
                    flood-color="#FF5500" flood-opacity="0.55"/>
      <feDropShadow dx="0" dy="${4 * scale}" stdDeviation="${glowBlur * 0.3}"
                    flood-color="#000000" flood-opacity="0.45"/>
    </filter>

    <!-- Inner shine gradient -->
    <linearGradient id="shine" x1="0" y1="${gradY1}" x2="0" y2="${gradY2}"
                    gradientUnits="userSpaceOnUse">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.00"/>
    </linearGradient>

    <!-- Subtle border gradient -->
    <linearGradient id="border" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#ff6666" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="#cc0000" stop-opacity="0.8"/>
    </linearGradient>
  </defs>

  <!-- Glow halo ring (blurred, behind button) -->
  <rect x="${btnX - glowR * 0.5}" y="${btnY - glowR * 0.5}"
        width="${btnW + glowR}" height="${btnH + glowR}"
        rx="${radius + glowR * 0.5}" ry="${radius + glowR * 0.5}"
        fill="none" stroke="#FF2200" stroke-width="${glowR * 1.2}"
        opacity="0.35" filter="url(#glow)"/>

  <!-- Main pill body with glow filter -->
  <rect x="${btnX}" y="${btnY}" width="${btnW}" height="${btnH}"
        rx="${radius}" ry="${radius}"
        fill="#FF0000"
        filter="url(#glow)"/>

  <!-- Inner highlight shine overlay -->
  <rect x="${btnX}" y="${btnY}" width="${btnW}" height="${btnH * 0.5}"
        rx="${radius}" ry="${radius}"
        fill="url(#shine)"/>

  <!-- Thin border for crispness -->
  <rect x="${btnX + 1.5}" y="${btnY + 1.5}" width="${btnW - 3}" height="${btnH - 3}"
        rx="${radius - 1}" ry="${radius - 1}"
        fill="none" stroke="rgba(255,255,255,0.20)" stroke-width="${1.5 * scale}"/>

  <!-- Bell emoji -->
  <text x="${cx}" y="${bellY}"
        font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif"
        font-size="${bellSize}"
        text-anchor="middle"
        dominant-baseline="auto">🔔</text>

  <!-- SUBSCRIBE text -->
  <text x="${textX}" y="${textY}"
        font-family="Arial Black, Arial, Helvetica, sans-serif"
        font-size="${fontSize}"
        font-weight="900"
        letter-spacing="${2 * scale}"
        fill="white"
        stroke="rgba(0,0,0,0.25)"
        stroke-width="${1.5 * scale}"
        paint-order="stroke fill"
        dominant-baseline="auto">SUBSCRIBE</text>
</svg>`;

    await sharp(Buffer.from(svg))
        .png()
        .toFile(outputPath);

    return outputPath;
}

module.exports = { renderSubscribeButton };
