# Use Node.js LTS
FROM node:20-bookworm-slim

# Install FFmpeg (required for video generation)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libatomic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies (no secrets needed at build time)
RUN npm ci --omit=dev

# Copy application
COPY . .

# Create output directories (output/, output/media)
RUN mkdir -p output output/media

EXPOSE 3000

CMD ["npm", "start"]
