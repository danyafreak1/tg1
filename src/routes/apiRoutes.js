import express from 'express';
import multer from 'multer';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from '../config/env.js';
import { toPublicError } from '../utils/errors.js';

export function createApiRouter({ backend, storage, userState }) {
  const router = express.Router();

  const upload = multer({
    dest: config.uploadsDir,
    limits: {
      fileSize: config.maxUploadMb * 1024 * 1024
    }
  });

  router.get('/health', async (_req, res) => {
    res.json({
      status: 'ok',
      baseUrl: config.baseUrl,
      maxUploadMb: config.maxUploadMb,
      maxConcurrentJobs: config.maxConcurrentJobs,
      queueSize: backend.queue.pending.length
    });
  });

  router.post('/api/convert', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded. Use form field "file".' });
        return;
      }

      const finalInputPath = storage.createUploadPath(req.file.originalname);
      await fs.rename(req.file.path, finalInputPath);

      const job = await backend.createJobFromUpload({
        inputPath: finalInputPath,
        originalName: req.file.originalname,
        source: 'web',
        options: {
          inputType: req.file.mimetype?.startsWith('image/') ? 'image' : 'video',
          roundedCorners: String(req.body?.roundedCorners || '').toLowerCase() === 'true',
          forceSquare: String(req.body?.forceSquare || '').toLowerCase() === 'true'
        }
      });

      res.status(202).json({ job });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: toPublicError(error) });
    }
  });

  router.post('/api/generate-sticker', upload.single('file'), async (req, res) => {
    try {
      if (req.file && !req.file.mimetype?.startsWith('image/')) {
        res.status(400).json({ error: 'Only image uploads are supported for generation.' });
        return;
      }

      const prompt = String(req.body?.prompt || '').trim();
      if (!prompt) {
        res.status(400).json({ error: 'Prompt is required.' });
        return;
      }

      let finalInputPath = null;
      let originalName = 'prompt-only';
      if (req.file) {
        finalInputPath = storage.createUploadPath(req.file.originalname);
        await fs.rename(req.file.path, finalInputPath);
        originalName = req.file.originalname;
      }

      const job = await backend.createJobFromUpload({
        inputPath: finalInputPath,
        originalName,
        source: 'web',
        options: {
          jobType: 'generate_sticker',
          inputType: 'image',
          outputExtension: '.webp',
          prompt,
          roundedCorners: String(req.body?.roundedCorners || '').toLowerCase() === 'true',
          forceSquare: String(req.body?.forceSquare || '').toLowerCase() === 'true'
        }
      });

      res.status(202).json({ job });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: toPublicError(error) });
    }
  });

  router.get('/api/jobs', (_req, res) => {
    res.json({ jobs: backend.listRecentJobs(10) });
  });

  router.get('/api/stickers/recent', async (_req, res) => {
    try {
      const users = await userState.getAllUsers();
      const stickers = Object.entries(users)
        .flatMap(([userId, user]) =>
          (user.stickerSets || []).flatMap((set) =>
            (set.stickers || []).map((sticker) => ({
              userId,
              setName: set.name,
              setTitle: set.title,
              addUrl: `https://t.me/addstickers/${set.name}`,
              fileId: sticker.fileId,
              emoji: sticker.emoji || '🫥',
              sourceOriginalName: sticker.sourceOriginalName || null,
              sourceJobId: sticker.sourceJobId || null,
              addedAt: sticker.addedAt || set.createdAt || null
            }))
          )
        )
        .sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0))
        .slice(0, 24);

      res.json({ stickers });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: toPublicError(error) });
    }
  });

  router.get('/api/jobs/:id', (req, res) => {
    try {
      const job = backend.toPublicJob(backend.getJob(req.params.id));
      res.json({ job });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: toPublicError(error) });
    }
  });

  router.get('/api/files/:id', async (req, res) => {
    try {
      const job = await backend.getFile(req.params.id);
      res.download(job.outputPath, path.basename(job.outputPath));
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: toPublicError(error) });
    }
  });

  return router;
}
