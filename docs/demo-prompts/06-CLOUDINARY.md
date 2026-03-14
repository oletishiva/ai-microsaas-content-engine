# Section 6: Cloudinary (Cloud Publish)

**Goal:** Upload the generated MP4 to Cloudinary and get a public URL.

---

## Prompt to Paste in Cursor

```
Add Cloudinary video upload.

1. npm install cloudinary

2. Create config/cloudinary.js:
   - Load CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET from env
   - Configure cloudinary.v2.config()
   - Export cloudinary and hasCloudinaryConfig (true if all 3 set)

3. Create src/services/cloudinaryUploader.js:
   - uploadVideoToCloudinary(videoPath, publicId)
   - Use cloudinary.uploader.upload with resource_type: "video"
   - Folder: "ai-content-engine"
   - Return result.secure_url (public URL)
   - If not configured, throw clear error
```

---

## What You Need

- Cloudinary account (free tier)
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` in `.env`

---

## API Shape

```js
const { uploadVideoToCloudinary } = require('./services/cloudinaryUploader');

const url = await uploadVideoToCloudinary("/path/to/video.mp4", "video_123");
// Returns: "https://res.cloudinary.com/your-cloud/video/upload/..."
```

---

## Next

→ [07-YOUTUBE-VIRAL](07-YOUTUBE-VIRAL.md)
