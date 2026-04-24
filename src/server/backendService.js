import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { createId } from '../utils/ids.js';

export class BackendService extends EventEmitter {
  constructor({ storage, converter, queue, imageGenerationService = null, videoGenerationService = null }) {
    super();
    this.storage = storage;
    this.converter = converter;
    this.queue = queue;
    this.imageGenerationService = imageGenerationService;
    this.videoGenerationService = videoGenerationService;
    this.jobs = new Map();
  }

  createJobRecord({ inputPath, originalName, source, owner, options = {} }) {
    const id = createId('job_');
    const jobType = options.jobType || 'convert';
    const outputExtension = options.outputExtension || (options.inputType === 'image' ? '.webp' : '.webm');
    const outputPath = this.storage.createOutputPath(id, outputExtension);
    const now = new Date().toISOString();
    const job = {
      id,
      jobType,
      source,
      owner,
      options,
      originalName,
      inputPath,
      outputPath,
      status: 'queued',
      progressStage: 'queued',
      progressDetail: null,
      error: null,
      createdAt: now,
      updatedAt: now
    };

    this.jobs.set(id, job);
    return job;
  }

  async createJobFromUpload({ inputPath, originalName, source = 'web', owner = null, options = {} }) {
    const job = this.createJobRecord({ inputPath, originalName, source, owner, options });
    this.queue.enqueue(job);
    return this.toPublicJob(job);
  }

  async handleJob(job) {
    job.status = 'processing';
    job.progressStage = ['generate_sticker', 'generate_image'].includes(job.jobType) ? 'generating' : 'converting';
    job.updatedAt = new Date().toISOString();
    this.emit('job.updated', { job: this.toPublicJob(job), internalJob: job });

    try {
      const result = job.jobType === 'generate_sticker'
        ? await this.handleGeneratedStickerJob(job)
        : job.jobType === 'generate_video'
          ? await this.handleGeneratedVideoJob(job)
        : job.jobType === 'generate_image'
          ? await this.handleGeneratedImageJob(job)
          : await this.converter.convert({
            inputPath: job.inputPath,
            outputPath: job.outputPath,
            inputType: job.options?.inputType || 'video',
            roundedCorners: Boolean(job.options?.roundedCorners),
            forceSquare: Boolean(job.options?.forceSquare)
          });

      job.status = 'done';
      job.progressStage = 'done';
      job.progressDetail = null;
      job.outputPath = result.outputPath || job.outputPath;
      if (result.generatedSourcePath) {
        job.generatedSourcePath = result.generatedSourcePath;
      }
      if (result.cleanupPaths) {
        job.cleanupPaths = result.cleanupPaths;
      }
      if (result.originalName && job.originalName === 'prompt-only') {
        job.originalName = result.originalName;
      }
      job.result = {
        size: result.size,
        outputFilename: path.basename(job.outputPath),
        format: result.format || (job.options?.inputType === 'image' ? 'static' : 'video'),
        provider: result.provider || null,
        revisedPrompt: result.revisedPrompt || null
      };
      job.updatedAt = new Date().toISOString();
      this.emit('job.done', { job: this.toPublicJob(job), internalJob: job });
    } catch (error) {
      job.status = 'failed';
      job.progressStage = 'failed';
      job.progressDetail = error.message;
      job.error = error.message;
      job.updatedAt = new Date().toISOString();
      this.emit('job.failed', { job: this.toPublicJob(job), internalJob: job });
    } finally {
      this.emit('job.updated', { job: this.toPublicJob(job), internalJob: job });
    }
  }

  async handleGeneratedStickerJob(job) {
    if (!this.imageGenerationService) {
      throw new AppError('Image generation service is not configured.', 500);
    }

    job.progressStage = 'generating';
    job.progressDetail = 'Generating image';
    job.updatedAt = new Date().toISOString();
    this.emit('job.updated', { job: this.toPublicJob(job), internalJob: job });

    const generated = await this.imageGenerationService.generateImage({
      jobId: job.id,
      sourceImagePath: job.inputPath,
      prompt: job.options?.prompt || ''
    });

    job.progressStage = 'converting';
    job.progressDetail = 'Converting to sticker';
    job.updatedAt = new Date().toISOString();
    this.emit('job.updated', { job: this.toPublicJob(job), internalJob: job });

    const converted = await this.converter.convert({
      inputPath: generated.outputPath,
      outputPath: job.outputPath,
      inputType: 'image',
      roundedCorners: Boolean(job.options?.roundedCorners),
      forceSquare: Boolean(job.options?.forceSquare)
    });

    return {
      ...converted,
      format: 'static',
      provider: generated.provider,
      revisedPrompt: generated.revisedPrompt || null,
      generatedSourcePath: generated.generatedSourcePath || generated.outputPath,
      originalName: generated.originalName || path.basename(generated.outputPath)
    };
  }

  async handleGeneratedImageJob(job) {
    if (!this.imageGenerationService) {
      throw new AppError('Image generation service is not configured.', 500);
    }

    job.progressStage = 'generating';
    job.progressDetail = 'Generating image';
    job.updatedAt = new Date().toISOString();
    this.emit('job.updated', { job: this.toPublicJob(job), internalJob: job });

    const generated = await this.imageGenerationService.generateImage({
      jobId: job.id,
      sourceImagePath: job.inputPath,
      prompt: job.options?.prompt || ''
    });

    job.progressStage = 'converting';
    job.progressDetail = 'Preparing preview';
    job.updatedAt = new Date().toISOString();
    this.emit('job.updated', { job: this.toPublicJob(job), internalJob: job });

    const preview = await this.converter.prepareImagePreview({
      inputPath: generated.outputPath,
      outputPath: job.outputPath,
      forceSquare: false
    });

    return {
      outputPath: preview.outputPath,
      size: preview.size ?? generated.size ?? null,
      format: 'image',
      provider: generated.provider,
      revisedPrompt: generated.revisedPrompt || null,
      generatedSourcePath: generated.generatedSourcePath || generated.outputPath,
      originalName: generated.originalName || path.basename(generated.outputPath)
    };
  }

  async handleGeneratedVideoJob(job) {
    if (!this.videoGenerationService) {
      throw new AppError('AI video generation service is not configured.', 500);
    }

    job.progressStage = 'generating';
    job.progressDetail = 'Generating video';
    job.updatedAt = new Date().toISOString();
    this.emit('job.updated', { job: this.toPublicJob(job), internalJob: job });

    const generated = await this.videoGenerationService.generateVideo({
      jobId: job.id,
      referenceImagePath: job.inputPath,
      promptMode: job.options?.promptMode || 'custom',
      prompt: job.options?.prompt || ''
    });

    job.progressStage = 'converting';
    job.progressDetail = 'Preparing preview';
    job.updatedAt = new Date().toISOString();
    this.emit('job.updated', { job: this.toPublicJob(job), internalJob: job });

    const stats = await fs.stat(generated.outputPath);

    return {
      outputPath: generated.outputPath,
      size: stats.size,
      format: 'video',
      provider: generated.provider,
      revisedPrompt: generated.effectivePrompt || null,
      generatedSourcePath: generated.outputPath,
      cleanupPaths: generated.cleanupPaths || []
    };
  }

  getJob(id) {
    const job = this.jobs.get(id);
    if (!job) {
      throw new AppError('Job not found', 404);
    }

    return job;
  }

  listRecentJobs(limit = 10) {
    return Array.from(this.jobs.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit)
      .map((job) => this.toPublicJob(job));
  }

  toPublicJob(job) {
    return {
      id: job.id,
      jobType: job.jobType,
      status: job.status,
      source: job.source,
      originalName: job.originalName,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      error: job.error,
      options: job.options || {},
      downloadUrl: job.status === 'done' ? `${config.baseUrl}/api/files/${job.id}` : null,
      progressStage: job.progressStage || null,
      progressDetail: job.progressDetail || null,
      outputSizeBytes: job.result?.size ?? null,
      outputFormat: job.result?.format ?? null,
      provider: job.result?.provider ?? null,
      revisedPrompt: job.result?.revisedPrompt ?? null
    };
  }

  async getFile(jobId) {
    const job = this.getJob(jobId);
    if (job.status !== 'done') {
      throw new AppError('File is not ready yet.', 409);
    }

    await fs.access(job.outputPath);
    return job;
  }
}
