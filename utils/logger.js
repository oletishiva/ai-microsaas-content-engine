/**
 * utils/logger.js
 * ----------------
 * Simple structured logger for the AI Content Engine.
 * Provides consistent timestamps and log levels.
 */

function timestamp() {
    return new Date().toISOString();
}

function log(level, tag, message, ...args) {
    const prefix = `[${timestamp()}] [${level}] [${tag}]`;
    if (args.length > 0) {
        console.log(prefix, message, ...args);
    } else {
        console.log(prefix, message);
    }
}

function error(tag, message, err) {
    const prefix = `[${timestamp()}] [ERROR] [${tag}]`;
    if (err) {
        console.error(prefix, message, err instanceof Error ? err.message : err);
    } else {
        console.error(prefix, message);
    }
}

function warn(tag, message, ...args) {
    const prefix = `[${timestamp()}] [WARN] [${tag}]`;
    if (args.length > 0) {
        console.warn(prefix, message, ...args);
    } else {
        console.warn(prefix, message);
    }
}

module.exports = {
    info: (tag, msg, ...args) => log("INFO", tag, msg, ...args),
    warn,
    error,
};
