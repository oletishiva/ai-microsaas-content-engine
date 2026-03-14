#!/usr/bin/env node
/**
 * scripts/get-youtube-refresh-token.js
 * -------------------------------------
 * One-time OAuth2 flow to obtain a YouTube refresh token.
 * Run this before testing uploads – no OpenAI/ElevenLabs/Pexels used.
 *
 * Usage:
 *   1. Add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET to .env
 *   2. Run: node scripts/get-youtube-refresh-token.js
 *   3. Visit the printed URL, sign in with Google, authorize
 *   4. You'll be redirected to localhost – copy the refresh token from the page
 *   5. Add YOUTUBE_REFRESH_TOKEN=... to .env
 */

require("dotenv").config();
const http = require("http");
const { google } = require("googleapis");
const url = require("url");

// Use port 3456 to avoid conflict with main app (port 3000)
// Always use this port for redirect – ignore YOUTUBE_REDIRECT_URI from .env
const AUTH_PORT = process.env.AUTH_PORT || process.env.YOUTUBE_AUTH_PORT || 3456;
const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REDIRECT_URI = `http://localhost:${AUTH_PORT}/oauth2callback`;

if (!CLIENT_ID || !CLIENT_SECRET || CLIENT_ID === "your_google_client_id_here") {
    console.error("\n❌ Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET in .env");
    console.error("   Get them from: https://console.cloud.google.com/apis/credentials\n");
    process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const server = http.createServer(async (req, res) => {
    const { pathname, query } = url.parse(req.url, true);

    if (pathname === "/oauth2callback" && query.code) {
        try {
            const { tokens } = await oauth2Client.getToken(query.code);
            const refreshToken = tokens.refresh_token;

            if (!refreshToken) {
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end(`
                    <h2>No refresh token received</h2>
                    <p>You may have already authorized this app. Try revoking access at
                    <a href="https://myaccount.google.com/permissions">Google Account permissions</a>
                    and run this script again.</p>
                `);
                server.close();
                return;
            }

            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(`
                <h2>✅ Success!</h2>
                <p>Add this to your <code>.env</code> file:</p>
                <pre style="background:#f5f5f5;padding:1em;overflow-x:auto;">YOUTUBE_REFRESH_TOKEN=${refreshToken}</pre>
                <p>Then run <code>node scripts/test-youtube-upload.js</code> to verify.</p>
                <p><small>You can close this tab.</small></p>
            `);

            console.log("\n✅ Refresh token received! Add to .env:\n");
            console.log(`YOUTUBE_REFRESH_TOKEN=${refreshToken}\n`);
        } catch (err) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Error: " + err.message);
            console.error(err);
        }
        server.close();
    } else {
        res.writeHead(404);
        res.end("Not found");
    }
});

server.listen(AUTH_PORT, () => {
    console.log(`\n   Auth server: http://localhost:${AUTH_PORT}/oauth2callback`);
    if (AUTH_PORT !== 3000) {
        console.log(`
   ⚠️  Ensure this is in Google Cloud Console → Authorized redirect URIs:
   http://localhost:${AUTH_PORT}/oauth2callback
`);
    }
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: ["https://www.googleapis.com/auth/youtube.upload"],
        prompt: "select_account consent", // Force account/channel picker + consent
    });

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  YouTube OAuth2 – Get Refresh Token                         ║
╠══════════════════════════════════════════════════════════════╣
║  1. Open this URL in your browser:                          ║
║                                                             ║
║     ${authUrl}
║                                                             ║
║  2. Sign in – if you have multiple channels, pick the one you want║
║  3. Click "Allow" to grant upload permission                 ║
║  4. You'll be redirected – the refresh token will appear    ║
╚══════════════════════════════════════════════════════════════╝
`);
});
