/**
 * Corvo Video Assembly Service — ASYNC JOB QUEUE
 *
 * POST /assemble  → returns { jobId } immediately, processes in background
 * GET  /status/:jobId → returns { status, progress, downloadUrl? }
 * GET  /download/:filename → serves the final MP4
 */

const express = require("express");
const cors = require("cors");
const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs/promises");
const path = require("path");
const https = require("https");
const http = require("http");
const { v4: uuidv4 } = require("uuid");

const execFileAsync = promisify(execFile);

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const PORT = process.env.PORT || 3099;
const SECRET = process.env.VPS_ASSEMBLY_SECRET || "";
const WORK_DIR = path.join(__dirname, "tmp");
const OUTPUT_DIR = path.join(__dirname, "output");
const MAX_AGE_MS = 30 * 60 * 1000;

// In-memory job store
const jobs = new Map();

// ── Concurrency queue ──
const MAX_CONCURRENT = 2;
let activeJobs = 0;
const waitingQueue = []; // array of { jobId, body, resolve }

function enqueueJob(jobId, body) {
  return new Promise((resolve) => {
    waitingQueue.push({ jobId, body, resolve });
    drainQueue();
  });
}

function drainQueue() {
  while (activeJobs < MAX_CONCURRENT && waitingQueue.length > 0) {
    const { jobId, body, resolve } = waitingQueue.shift();
    activeJobs++;
    // Update queue position for remaining jobs
    waitingQueue.forEach((w, idx) => {
      const j = jobs.get(w.jobId);
      if (j) j.queuePosition = idx + 1;
    });
    const job = jobs.get(jobId);
    if (job) { job.progress = "downloading"; job.queuePosition = 0; }
    processJob(jobId, body)
      .catch((err) => {
        console.error(`[${jobId}] Unhandled error:`, err);
        const j = jobs.get(jobId);
        if (j) { j.status = "error"; j.error = err.message; }
      })
      .finally(() => {
        activeJobs--;
        drainQueue();
      });
    resolve();
  }
}

(async () => {
  await fs.mkdir(WORK_DIR, { recursive: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
})();

// ── Auth middleware ──
function authMiddleware(req, res, next) {
  if (!SECRET) return res.status(503).json({ error: "VPS_ASSEMBLY_SECRET not configured" });
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (token !== SECRET) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ── Health check ──
app.get("/health", (_, res) => res.json({ status: "ok", ffmpeg: true }));

// ── Download file from URL ──
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const file = require("fs").createWriteStream(dest);
    mod
      .get(url, { headers: { "User-Agent": "CorvoAssembler/1.0" } }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        }
        if (response.statusCode !== 200) {
          file.close();
          return reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        }
        response.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

// ── Get video duration with ffprobe ──
async function probeDuration(filePath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet", "-print_format", "json", "-show_format", filePath,
    ]);
    const info = JSON.parse(stdout);
    return parseFloat(info.format?.duration || "0");
  } catch {
    return 0;
  }
}

// ── Map transition style to xfade name ──
function mapTransition(style) {
  switch (style) {
    case "dissolve": return { transition: "dissolve", duration: 0.5 };
    case "whip-pan": return { transition: "wipeleft", duration: 0.35 };
    case "match-cut": return { transition: "fade", duration: 0.1 };
    case "none": return { transition: "fade", duration: 0.033 };
    case "dip-to-black":
    default: return { transition: "fadeblack", duration: 0.35 };
  }
}

// ── Process job in background ──
async function processJob(jobId, body) {
  const jobDir = path.join(WORK_DIR, jobId);
  await fs.mkdir(jobDir, { recursive: true });
  const job = jobs.get(jobId);

  try {
    const { clips, musicUrl, aspectRatio, brandOutro, showWatermark } = body;
    const arMap = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080], "4:5": [1080, 1350] };
    const [tw, th] = arMap[aspectRatio] || [1080, 1920];

    console.log(`[${jobId}] Starting assembly: ${clips.length} clips, ${tw}x${th}`);
    job.progress = "downloading";

    // ── Step 1: Download all clips ──
    const clipPaths = [];
    await Promise.all(
      clips.map(async (clip, i) => {
        const dest = path.join(jobDir, `input_${i}.mp4`);
        await downloadFile(clip.url, dest);
        clipPaths[i] = dest;
        console.log(`[${jobId}] Downloaded clip ${i}`);
      }),
    );

    // ── Step 2: Pre-process each clip ──
    job.progress = "processing";
    const processedPaths = [];
    const processedDurations = [];
    const clipsHaveAudio = [];

    for (let i = 0; i < clips.length; i++) {
      job.progress = `processing ${i + 1}/${clips.length}`;
      const clip = clips[i];
      const rate = typeof clip.playbackRate === "number" && clip.playbackRate > 0 ? clip.playbackRate : 1.0;
      const dur = typeof clip.durationSeconds === "number" && clip.durationSeconds > 0 ? clip.durationSeconds : undefined;
      const startSec = typeof clip.startSeconds === "number" && clip.startSeconds > 0 ? clip.startSeconds : undefined;
      const outPath = path.join(jobDir, `clip_${i}.mp4`);

      const vfFilters = [];
      if (rate !== 1.0) vfFilters.push(`setpts=PTS/${rate}`);
      vfFilters.push(`scale=${tw}:${th}:force_original_aspect_ratio=increase`);
      vfFilters.push(`crop=${tw}:${th}`);

      if (showWatermark) {
        const fontSize = Math.round(Math.min(tw, th) * 0.028);
        vfFilters.push(
          `drawtext=text='corvo AI':fontsize=${fontSize}:fontcolor=white@0.55:x=(w-text_w)/2:y=h-${Math.round(th * 0.03)}`,
        );
      }

      let sfxPath = null;
      if (clip.sfxUrl) {
        try {
          const sfxExt = clip.sfxUrl.includes(".wav") ? ".wav" : ".mp3";
          sfxPath = path.join(jobDir, `sfx_${i}${sfxExt}`);
          await downloadFile(clip.sfxUrl, sfxPath);
        } catch (e) {
          console.warn(`[${jobId}] SFX download failed for clip ${i}:`, e.message);
          sfxPath = null;
        }
      }

      // Build ffmpeg args — use -ss before -i for fast seek
      const args = [];
      if (startSec) args.push("-ss", String(startSec));
      args.push("-i", clipPaths[i]);
      if (sfxPath) args.push("-i", sfxPath);
      if (dur) args.push("-t", String(dur));
      args.push("-vf", vfFilters.join(","));
      args.push("-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p");

      // Download voiceover source if specified (avatar audio over product B-roll)
      let voPath = null;
      if (clip.voiceoverFrom) {
        try {
          voPath = path.join(jobDir, `vo_${i}.mp4`);
          await downloadFile(clip.voiceoverFrom, voPath);
          console.log(`[${jobId}] Downloaded voiceover source for clip ${i}`);
        } catch (e) {
          console.warn(`[${jobId}] Voiceover download failed for clip ${i}:`, e.message);
          voPath = null;
        }
      }

      if (sfxPath) {
        const sfxVol = typeof clip.sfxVolume === "number" ? clip.sfxVolume : 0.6;
        args.push("-filter_complex", `[1:a]volume=${sfxVol.toFixed(2)}[sfx]`);
        args.push("-map", "0:v", "-map", "[sfx]");
        args.push("-c:a", "aac", "-b:a", "128k");
        clipsHaveAudio.push(true);
      } else if (voPath) {
        // Voiceover mode: use video from clip, audio from voiceover source
        // voPath is added as a second input; -ss on the voiceover aligns timing
        const voStart = typeof clip.voiceoverStartSeconds === "number" ? clip.voiceoverStartSeconds : 0;
        // We need to re-build args to insert the voiceover input
        // Remove the existing -i and re-add with voiceover
        // Actually, voPath needs to be a separate input — append it
        args.push("-ss", String(voStart), "-i", voPath);
        // Map: video from first input (index 0 or 1 depending on whether -ss was used before first -i)
        // The inputs are: [0] = clip video, [1 or 2] = voiceover
        // Since we already pushed -i clipPaths[i], and possibly sfxPath wasn't added,
        // voPath is the next input index
        const voInputIdx = sfxPath ? 2 : 1;
        args.push("-map", "0:v", "-map", `${voInputIdx}:a`);
        args.push("-c:a", "aac", "-b:a", "128k");
        clipsHaveAudio.push(true);
      } else if (clip.keepAudio) {
        args.push("-c:a", "aac", "-b:a", "128k");
        clipsHaveAudio.push(true);
      } else {
        args.push("-an");
        clipsHaveAudio.push(false);
      }
      args.push("-y", outPath);

      await execFileAsync("ffmpeg", args, { timeout: 120000 });
      const actualDur = await probeDuration(outPath);
      processedPaths.push(outPath);
      processedDurations.push(actualDur || (dur ? dur / rate : 5));
    }

    // ── Step 3: Brand outro ──
    if (brandOutro?.brandName) {
      const outroDur = brandOutro.duration || 3;
      const outroPath = path.join(jobDir, "outro.mp4");
      const fontSize = Math.round(tw * 0.07);
      const sloganSize = Math.round(tw * 0.03);

      let drawFilters = `color=black:s=${tw}x${th}:d=${outroDur},drawtext=text='${brandOutro.brandName.replace(/'/g, "\\'")}':fontsize=${fontSize}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`;
      if (brandOutro.slogan) {
        drawFilters += `,drawtext=text='${brandOutro.slogan.replace(/'/g, "\\'")}':fontsize=${sloganSize}:fontcolor=white@0.85:x=(w-text_w)/2:y=(h/2)+${Math.round(fontSize * 0.8)}`;
      }

      await execFileAsync("ffmpeg", [
        "-f", "lavfi", "-i", drawFilters,
        "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-t", String(outroDur), "-y", outroPath,
      ], { timeout: 30000 });

      processedPaths.push(outroPath);
      processedDurations.push(outroDur);
      clipsHaveAudio.push(false);
      clips.push({ transitionStyle: "dip-to-black", isContinuousFromPrev: false });
    }

    // ── Step 4: Merge with xfade (pair-by-pair for progress reporting) ──
    const totalPairs = processedPaths.length - 1;
    job.progress = totalPairs > 0 ? `merging 0/${totalPairs}` : "merging";
    const mergedPath = path.join(jobDir, "merged.mp4");

    if (processedPaths.length === 1) {
      await fs.copyFile(processedPaths[0], mergedPath);
    } else {
      // Iterative pair-by-pair merge so we can report progress per pair
      let currentPath = processedPaths[0];
      let currentDur = processedDurations[0];

      for (let i = 1; i < processedPaths.length; i++) {
        const pairStart = Date.now();
        const clip = clips[i] || {};
        const isLast = i === processedPaths.length - 1;
        const pairOut = isLast ? mergedPath : path.join(jobDir, `pair_${i}.mp4`);

        let xfadeType, xfadeDur;
        if (clip.isContinuousFromPrev) {
          xfadeType = "fade"; xfadeDur = 0.033;
        } else {
          const mapped = mapTransition(clip.transitionStyle);
          xfadeType = mapped.transition; xfadeDur = mapped.duration;
        }
        xfadeDur = Math.min(xfadeDur, currentDur * 0.8, processedDurations[i] * 0.8);
        const offset = Math.max(0, currentDur - xfadeDur);

        const filter = `[0:v][1:v]xfade=transition=${xfadeType}:duration=${xfadeDur.toFixed(3)}:offset=${offset.toFixed(3)}[vout]`;

        try {
          await execFileAsync("ffmpeg", [
            "-i", currentPath, "-i", processedPaths[i],
            "-filter_complex", filter,
            "-map", "[vout]",
            "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
            "-an", "-y", pairOut,
          ], { timeout: 120000 });
        } catch (xfadeErr) {
          console.warn(`[${jobId}] xfade pair ${i} failed, falling back to concat:`, xfadeErr.message);
          const listPath = path.join(jobDir, `list_${i}.txt`);
          await fs.writeFile(listPath, `file '${currentPath}'\nfile '${processedPaths[i]}'`);
          await execFileAsync("ffmpeg", [
            "-f", "concat", "-safe", "0", "-i", listPath,
            "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
            "-an", "-y", pairOut,
          ], { timeout: 120000 });
        }

        currentDur = offset + processedDurations[i];
        currentPath = pairOut;

        const elapsed = ((Date.now() - pairStart) / 1000).toFixed(1);
        console.log(`[${jobId}] Merged pair ${i} (${elapsed}s)`);
        job.progress = `merging ${i}/${totalPairs}`;
      }

      // Now mix audio from clips that have SFX
      const anyAudio = clipsHaveAudio.some(Boolean);
      if (anyAudio) {
        const audioMergedPath = path.join(jobDir, "merged_audio.mp4");
        const audioInputs = processedPaths.flatMap((p) => ["-i", p]);
        const audioFilters = [];
        for (let i = 0; i < processedPaths.length; i++) {
          if (clipsHaveAudio[i]) {
            audioFilters.push(`[${i}:a]apad=pad_dur=0[a${i}]`);
          } else {
            audioFilters.push(`anullsrc=r=44100:cl=stereo,atrim=0:${processedDurations[i].toFixed(3)}[a${i}]`);
          }
        }
        const concatInputs = processedPaths.map((_, i) => `[a${i}]`).join("");
        audioFilters.push(`${concatInputs}concat=n=${processedPaths.length}:v=0:a=1[aout]`);

        try {
          await execFileAsync("ffmpeg", [
            "-i", mergedPath, ...audioInputs,
            "-filter_complex", audioFilters.join(";"),
            "-map", "0:v", "-map", "[aout]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
            "-y", audioMergedPath,
          ], { timeout: 120000 });
          await fs.copyFile(audioMergedPath, mergedPath);
        } catch (audioErr) {
          console.warn(`[${jobId}] Audio concat failed, continuing without SFX:`, audioErr.message);
        }
      }
    }

    // ── Step 5: Mix background music ──
    job.progress = "finalizing";
    let finalPath = mergedPath;
    if (musicUrl) {
      const musicExt = musicUrl.includes(".wav") ? ".wav" : ".mp3";
      const musicPath = path.join(jobDir, `music${musicExt}`);
      await downloadFile(musicUrl, musicPath);

      const outputPath = path.join(jobDir, "output.mp4");
      const hasSfx = clipsHaveAudio.some(Boolean);

      try {
        if (hasSfx) {
          await execFileAsync("ffmpeg", [
            "-i", mergedPath, "-i", musicPath, "-c:v", "copy",
            "-filter_complex", "[0:a]aformat=fltp:44100:stereo[sfx];[1:a]volume=0.45,aformat=fltp:44100:stereo[bgm];[sfx][bgm]amix=inputs=2:duration=first:dropout_transition=2[a]",
            "-map", "0:v", "-map", "[a]", "-c:a", "aac", "-b:a", "128k",
            "-shortest", "-movflags", "+faststart", "-y", outputPath,
          ], { timeout: 120000 });
        } else {
          await execFileAsync("ffmpeg", [
            "-i", mergedPath, "-i", musicPath, "-c:v", "copy",
            "-filter_complex", "[1:a]volume=0.45[a]",
            "-map", "0:v", "-map", "[a]", "-c:a", "aac", "-b:a", "128k",
            "-shortest", "-movflags", "+faststart", "-y", outputPath,
          ], { timeout: 120000 });
        }
        finalPath = outputPath;
      } catch (e) {
        console.warn(`[${jobId}] Music mixing failed:`, e.message);
      }
    } else {
      const outputPath = path.join(jobDir, "output.mp4");
      try {
        await execFileAsync("ffmpeg", ["-i", mergedPath, "-c", "copy", "-movflags", "+faststart", "-y", outputPath], { timeout: 60000 });
        finalPath = outputPath;
      } catch {}
    }

    // Move to output dir
    const outputFileName = `${jobId}.mp4`;
    const outputFilePath = path.join(OUTPUT_DIR, outputFileName);
    await fs.copyFile(finalPath, outputFilePath);

    // Cleanup job dir
    fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});

    const fileStats = await fs.stat(outputFilePath);
    console.log(`[${jobId}] Done — ${clips.length} clips → ${(fileStats.size / 1024 / 1024).toFixed(1)} MB`);

    // Update job status
    job.status = "done";
    job.progress = "done";
    job.downloadUrl = `/download/${outputFileName}`;
    job.sizeMB = +(fileStats.size / 1024 / 1024).toFixed(1);
  } catch (err) {
    console.error(`[${jobId}] Assembly error:`, err);
    fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    job.status = "error";
    job.error = err.message || "Assembly failed";
  }
}

// ── POST /assemble — returns jobId immediately ──
app.post("/assemble", authMiddleware, async (req, res) => {
  const { clips } = req.body;
  if (!clips || !Array.isArray(clips) || clips.length === 0) {
    return res.status(400).json({ error: "No clips provided" });
  }

  const jobId = uuidv4();
  const queuePosition = activeJobs >= MAX_CONCURRENT ? waitingQueue.length + 1 : 0;
  jobs.set(jobId, {
    status: "processing",
    progress: queuePosition > 0 ? "queued" : "queued",
    createdAt: Date.now(),
    downloadUrl: null,
    error: null,
    queuePosition,
  });

  // Enqueue — will start immediately if under limit, otherwise wait
  enqueueJob(jobId, req.body);

  console.log(`[${jobId}] Job queued: ${clips.length} clips (position: ${queuePosition}, active: ${activeJobs})`);
  res.json({ success: true, jobId, queuePosition });
});

// ── GET /status/:jobId ──
app.get("/status/:jobId", authMiddleware, (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }
  res.json({
    status: job.status,
    progress: job.progress,
    downloadUrl: job.downloadUrl,
    sizeMB: job.sizeMB || null,
    error: job.error,
    queuePosition: job.queuePosition || 0,
  });
});

// ── GET /download/:filename ──
app.get("/download/:filename", async (req, res) => {
  const filePath = path.join(OUTPUT_DIR, req.params.filename);
  try {
    await fs.access(filePath);
    res.download(filePath, "corvo-ad.mp4", () => {
      // Delete output file after successful download to free disk space
      fs.unlink(filePath).catch(() => {});
      // Also clean job from memory
      const jobId = req.params.filename.replace(/\.mp4$/, "");
      jobs.delete(jobId);
      console.log(`[${jobId}] Output file cleaned after download`);
    });
  } catch {
    res.status(404).json({ error: "File not found or expired" });
  }
});

// ══════════════════════════════════════════
// ── Seedance 2.0 Proxy (Segmind API) ──
// Segmind's Seedance API is synchronous (~174s avg) which exceeds Edge Function limits.
// VPS handles the long-running call, Edge Function submits and polls via jobId.
// ══════════════════════════════════════════

const seedanceJobs = new Map();

app.post("/generate-seedance", authMiddleware, async (req, res) => {
  const jobId = uuidv4();
  const body = req.body;

  seedanceJobs.set(jobId, {
    status: "processing",
    progress: "submitted",
    createdAt: Date.now(),
    videoUrl: null,
    error: null,
  });

  res.json({ jobId, status: "processing" });

  // Process in background
  processSeedanceJob(jobId, body).catch((err) => {
    console.error(`[seedance:${jobId}] Error:`, err);
    const job = seedanceJobs.get(jobId);
    if (job) {
      job.status = "failed";
      job.error = err.message || "Unknown error";
    }
  });
});

app.get("/seedance-status/:jobId", authMiddleware, (req, res) => {
  const job = seedanceJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({
    status: job.status,
    progress: job.progress,
    videoUrl: job.videoUrl,
    error: job.error,
  });
});

async function processSeedanceJob(jobId, body) {
  const job = seedanceJobs.get(jobId);
  const SEGMIND_API_KEY = process.env.SEGMIND_API_KEY;
  if (!SEGMIND_API_KEY) throw new Error("SEGMIND_API_KEY not configured on VPS");

  const {
    prompt,
    keyframeImage,
    endKeyframeImage,
    duration = 5,
    aspectRatio = "9:16",
  } = body;

  const VALID_DURATIONS = [4, 5, 6, 8, 10, 12, 15];
  const normDuration = VALID_DURATIONS.find(d => d >= duration) || 15;

  const VALID_AR = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
  const normAR = VALID_AR.includes(aspectRatio) ? aspectRatio : "9:16";

  const requestBody = {
    prompt,
    duration: normDuration,
    resolution: "720p",
    aspect_ratio: normAR,
    generate_audio: false,
    seed: -1,
    return_last_frame: false,
    reference_images: [],
    reference_videos: [],
    reference_audios: [],
  };

  if (keyframeImage) {
    requestBody.first_frame_url = keyframeImage;
    if (endKeyframeImage) requestBody.last_frame_url = endKeyframeImage;
  }

  job.progress = "generating";
  console.log(`[seedance:${jobId}] Calling Segmind API, duration=${normDuration}s, AR=${normAR}`);

  const startTime = Date.now();
  const segRes = await fetch("https://api.segmind.com/v1/seedance-2.0", {
    method: "POST",
    headers: {
      "x-api-key": SEGMIND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`[seedance:${jobId}] Segmind responded in ${elapsed}s, status=${segRes.status}`);

  if (!segRes.ok) {
    const errText = await segRes.text();
    throw new Error(`Segmind API error [${segRes.status}]: ${errText.substring(0, 200)}`);
  }

  const contentType = segRes.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const jsonData = await segRes.json();
    if (jsonData.error) throw new Error(`Seedance error: ${jsonData.error}`);
    if (jsonData.url || jsonData.video_url) {
      job.status = "completed";
      job.videoUrl = jsonData.url || jsonData.video_url;
      console.log(`[seedance:${jobId}] Got video URL from JSON response`);
      return;
    }
    throw new Error("Unexpected Seedance JSON response format");
  }

  // Binary response — upload to Supabase storage
  job.progress = "uploading";
  const videoBuffer = Buffer.from(await segRes.arrayBuffer());
  console.log(`[seedance:${jobId}] Got ${videoBuffer.length} bytes, uploading to storage...`);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (SUPABASE_URL && SERVICE_KEY) {
    const fileName = `seedance-${Date.now()}-${jobId.substring(0, 8)}.mp4`;
    const uploadPath = `generated/${fileName}`;
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/product-images/${uploadPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "video/mp4",
        "x-upsert": "true",
      },
      body: videoBuffer,
    });

    if (uploadRes.ok) {
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/product-images/${uploadPath}`;
      job.status = "completed";
      job.videoUrl = publicUrl;
      console.log(`[seedance:${jobId}] Uploaded: ${publicUrl}`);
      return;
    }
    const uploadErr = await uploadRes.text();
    console.error(`[seedance:${jobId}] Storage upload failed: ${uploadErr}`);
  }

  // Fallback: save to disk and serve from VPS
  const outPath = path.join(OUTPUT_DIR, `${jobId}.mp4`);
  await fs.writeFile(outPath, videoBuffer);
  const vpsBaseUrl = process.env.VPS_PUBLIC_URL || `http://localhost:${PORT}`;
  job.status = "completed";
  job.videoUrl = `${vpsBaseUrl}/download/${jobId}.mp4`;
  console.warn(`[seedance:${jobId}] Storage upload failed, serving from VPS: ${job.videoUrl}`);
  console.log(`[seedance:${jobId}] Saved to disk: ${outPath}`);
}

// Cleanup stale seedance jobs
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of seedanceJobs) {
    if (now - job.createdAt > MAX_AGE_MS) seedanceJobs.delete(id);
  }
}, 5 * 60 * 1000);

// ── Periodic cleanup (every 5 min) ──
setInterval(async () => {
  try {
    const now = Date.now();

    // Clean old output files
    const outFiles = await fs.readdir(OUTPUT_DIR);
    for (const f of outFiles) {
      const fp = path.join(OUTPUT_DIR, f);
      const stat = await fs.stat(fp);
      if (now - stat.mtimeMs > MAX_AGE_MS) {
        await fs.unlink(fp).catch(() => {});
        console.log(`[cleanup] Removed stale output: ${f}`);
      }
    }

    // Clean orphaned tmp job directories (crash residue)
    const tmpDirs = await fs.readdir(WORK_DIR);
    for (const d of tmpDirs) {
      const dp = path.join(WORK_DIR, d);
      try {
        const stat = await fs.stat(dp);
        if (stat.isDirectory() && now - stat.mtimeMs > MAX_AGE_MS) {
          await fs.rm(dp, { recursive: true, force: true });
          console.log(`[cleanup] Removed stale tmp dir: ${d}`);
        }
      } catch {}
    }

    // Clean old jobs from memory
    for (const [id, job] of jobs) {
      if (now - job.createdAt > MAX_AGE_MS) {
        jobs.delete(id);
      }
    }
  } catch {}
}, 5 * 60 * 1000);

// ── Crop landscape video to 9:16 portrait ──
app.post("/crop-portrait", authMiddleware, async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) return res.status(400).json({ error: "videoUrl required" });

  const jobDir = path.join(WORK_DIR, `crop-${uuidv4()}`);
  await fs.mkdir(jobDir, { recursive: true });
  const inputPath = path.join(jobDir, "input.mp4");
  const outputPath = path.join(jobDir, "portrait.mp4");

  try {
    // Download video
    await downloadFile(videoUrl, inputPath);

    // Probe dimensions
    const { stdout: probeOut } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0",
      inputPath,
    ]);
    const [w, h] = probeOut.trim().split(",").map(Number);
    console.log(`[crop-portrait] Input dimensions: ${w}x${h}`);

    if (!w || !h || h >= w) {
      // Already portrait or square
      await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
      return res.json({ alreadyPortrait: true });
    }

    // Crop to 9:16 from center
    const targetW = Math.floor(h * 9 / 16);
    const cropW = Math.min(targetW, w);
    const cropX = Math.floor((w - cropW) / 2);

    await execFileAsync("ffmpeg", [
      "-i", inputPath,
      "-vf", `crop=${cropW}:${h}:${cropX}:0`,
      "-c:a", "copy",
      "-y", outputPath,
    ]);

    // Move to output dir for serving
    const outName = `portrait-${uuidv4()}.mp4`;
    const finalPath = path.join(OUTPUT_DIR, outName);
    await fs.rename(outputPath, finalPath);
    await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    res.json({ croppedUrl: `${baseUrl}/download/${outName}` });
  } catch (err) {
    console.error("[crop-portrait] Error:", err);
    await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🎬 Corvo Assembler (async) running on port ${PORT}`);
});
