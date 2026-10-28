#!/usr/bin/env node
/**
 * scripts/start.js – the one launcher used by start.bat / start.command / start.sh / npm start.
 * Runs the server and restarts it when it exits with code 75 (Settings page saved new keys).
 * Opens the browser on first launch.
 */
const { spawn } = require("child_process");
const path = require("path");

let first = true;
function run() {
    const child = spawn(process.execPath, [path.join(__dirname, "..", "src", "app.js")], {
        stdio: "inherit",
        env: { ...process.env, STUDIO_SUPERVISED: "1", OPEN_BROWSER: first && process.env.NO_BROWSER !== "1" ? "1" : "0" },
    });
    first = false;
    child.on("exit", (code) => {
        if (code === 75) return run();
        process.exit(code || 0);
    });
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));
run();
