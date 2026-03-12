/**
 * src/services/cloudinaryUploader.js
 * ------------------------------------
 * Uploads generated videos to Cloudinary and returns a public URL.
 */

const fs = require("fs");
const path = require("path");
const { cloudinary, hasCloudinaryConfig } = require("../../config/cloudinary");
const logger = require("../../utils/logger");

const UPLOAD_FOLDER = "ai-content-engine";

/**
 * Upload a video file to Cloudinary.
 * @param {string} videoPath - Local path to the video file
 * @param {string} [publicId] - Optional public ID (defaults to filename without extension)
 * @returns {Promise<string>} - Public video URL (secure_url)
 */
async function uploadVideoToCloudinary(videoPath, publicId = null) {
    if (!hasCloudinaryConfig) {
        throw new Error(
            "Cloudinary not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET"
        );
    }
    if (!videoPath || !fs.existsSync(videoPath)) {
        throw new Error(`Video file not found: ${videoPath}`);
    }

    const id = publicId || path.basename(videoPath, path.extname(videoPath));

    return new Promise((resolve, reject) => {
        logger.info("CloudinaryUploader", "Upload started...");
        cloudinary.uploader.upload(
            videoPath,
            {
                resource_type: "video",
                folder: UPLOAD_FOLDER,
                public_id: id,
            },
            (err, result) => {
                if (err) {
                    logger.error("CloudinaryUploader", "Upload failed", err);
                    return reject(new Error(`Cloudinary upload failed: ${err.message}`));
                }
                const url = result.secure_url;
                logger.info("CloudinaryUploader", `Upload completed. Public URL: ${url}`);
                resolve(url);
            }
        );
    });
}

module.exports = { uploadVideoToCloudinary, hasCloudinaryConfig };
