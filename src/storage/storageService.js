import path from 'node:path';
import { promises as fs } from 'node:fs';
import { config } from '../config/env.js';
import { createId } from '../utils/ids.js';
import { ensureDir, sanitizeFilename } from '../utils/files.js';

export class StorageService {
  constructor() {
    this.uploadsDir = config.uploadsDir;
    this.outputsDir = config.outputsDir;
  }

  async init() {
    await ensureDir(this.uploadsDir);
    await ensureDir(this.outputsDir);
  }

  createUploadPath(originalName) {
    const safeName = sanitizeFilename(originalName);
    return path.join(this.uploadsDir, `${createId('upload_')}_${safeName}`);
  }

  createOutputPath(jobId, extension = '.webm') {
    return path.join(this.outputsDir, `${jobId}${extension}`);
  }

  createGeneratedAssetPath(jobId, extension = '.png') {
    return path.join(this.outputsDir, `${jobId}_generated${extension}`);
  }

  createGeneratedUploadPath(jobId, extension = '.png') {
    return this.createUploadPath(`generated_${jobId}${extension}`);
  }

  async removeFile(filePath) {
    if (!filePath) {
      return;
    }

    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async cleanup(jobs, ttlMinutes) {
    const now = Date.now();
    const ttlMs = ttlMinutes * 60 * 1000;

    for (const job of jobs.values()) {
      const updatedAt = new Date(job.updatedAt).getTime();
      const isExpired = Number.isFinite(updatedAt) && now - updatedAt > ttlMs;
      if (!isExpired) {
        continue;
      }

      await this.removeFile(job.inputPath);
      await this.removeFile(job.generatedSourcePath);
      await this.removeFile(job.outputPath);
      jobs.delete(job.id);
    }
  }
}
