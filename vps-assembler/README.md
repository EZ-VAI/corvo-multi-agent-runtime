# Corvo Video Assembly Service (VPS)

Server-side FFmpeg video assembly service. Runs on your Hostinger VPS.

## Prerequisites

- Node.js 18+
- FFmpeg installed (`sudo apt install ffmpeg`)

## Setup

```bash
# 1. Upload this folder to your VPS
scp -r vps-assembler/ user@your-vps-ip:~/corvo-assembler/

# 2. SSH into VPS
ssh user@your-vps-ip

# 3. Install dependencies
cd ~/corvo-assembler
npm install

# 4. Set auth secret (use a strong random string)
export VPS_ASSEMBLY_SECRET="change-me"

# 5. Start the service
npm start

# For production, use PM2:
npm install -g pm2
VPS_ASSEMBLY_SECRET="change-me" pm2 start server.js --name corvo-assembler
pm2 save
pm2 startup
```

## API

### POST /assemble
Assembles clips into a single MP4.

**Headers:** `Authorization: Bearer <VPS_ASSEMBLY_SECRET>`

**Body:**
```json
{
  "clips": [
    {
      "url": "https://...",
      "durationSeconds": 3,
      "playbackRate": 1.0,
      "transitionStyle": "dissolve",
      "isContinuousFromPrev": false,
      "sfxUrl": "https://...",
      "sfxVolume": 0.6
    }
  ],
  "musicUrl": "https://...",
  "aspectRatio": "9:16",
  "brandOutro": { "brandName": "Brand", "slogan": "Tagline", "duration": 3 },
  "showWatermark": false
}
```

**Response:**
```json
{
  "success": true,
  "jobId": "uuid",
  "downloadUrl": "/download/uuid.mp4",
  "sizeMB": 45.2
}
```

### GET /download/:filename
Downloads the assembled MP4. File auto-deletes after download.

### GET /health
Health check endpoint.

## Nginx Reverse Proxy (recommended)

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3099;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
