#!/usr/bin/env node
/**
 * Verify YouTube OAuth credentials and refresh token.
 * Run this to diagnose invalid_grant or other auth issues.
 */

require("dotenv").config();
const { google } = require("googleapis");

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REDIRECT_URI = process.env.YOUTUBE_REDIRECT_URI;
const REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN;

console.log("\n📋 YouTube OAuth config:\n");
console.log("  YOUTUBE_CLIENT_ID:", CLIENT_ID ? `${CLIENT_ID.slice(0, 20)}...` : "❌ missing");
console.log("  YOUTUBE_CLIENT_SECRET:", CLIENT_SECRET ? "✓ set" : "❌ missing");
console.log("  YOUTUBE_REDIRECT_URI:", REDIRECT_URI || "❌ missing");
console.log("  YOUTUBE_REFRESH_TOKEN:", REFRESH_TOKEN ? `${REFRESH_TOKEN.slice(0, 30)}...` : "❌ missing");

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    console.error("\n❌ Missing required env vars. Check .env\n");
    process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

console.log("\n🔄 Testing token refresh...\n");

oauth2Client
    .getAccessToken()
    .then(({ token }) => {
        console.log("✅ Token refresh OK! Auth is working.\n");
    })
    .catch((err) => {
        console.error("❌ Token refresh failed:\n");
        console.error("  Message:", err.message);
        if (err.response?.data) {
            console.error("  Response:", JSON.stringify(err.response.data, null, 2));
        }
        if (err.message?.includes("invalid_grant")) {
            console.error(`
  The refresh token doesn't match this OAuth client.
  - Token must be from the SAME client (Client ID) in Google Cloud Console
  - Revoke at myaccount.google.com/permissions, then run: npm run youtube:auth
`);
        }
        process.exit(1);
    });
