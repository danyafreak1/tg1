import path from 'node:path';
import { promises as fs } from 'node:fs';
import { config } from '../config/env.js';
import { AppError } from '../utils/errors.js';

const SOFT_BLUR = '6:3';
const MEDIUM_BLUR = '8:3';
const HARD_BLUR = '10:3';

function sanitizePrompt(value) {
  return String(value || '').trim();
}

function isSensitiveModerationError(error) {
  return /sensitive information/i.test(String(error?.message || ''));
}

export class VideoGenerationService {
  constructor({ storage, converter, provider, promptService = null }) {
    this.storage = storage;
    this.converter = converter;
    this.provider = provider;
    this.promptService = promptService;
  }

  createDebugPath(jobId, suffix, extension) {
    return path.join(config.outputsDir, `${jobId}_${suffix}${extension}`);
  }

  async prepareReferenceVariants(jobId, referenceImagePath) {
    const cleanupPaths = [];
    const debugPaths = {
      originalInputPng: null,
      flattenedReferencePng: null,
      seedanceOutputMp4: null
    };

    const inputHasAlpha = await this.converter.hasAlphaChannel(referenceImagePath);
    const originalDebugPath = this.createDebugPath(jobId, 'original-input', '.png');
    await fs.copyFile(referenceImagePath, originalDebugPath);
    debugPaths.originalInputPng = originalDebugPath;

    if (!inputHasAlpha) {
      const originalFileName = `seedance-ref-${jobId}.png`;
      const originalPublicPath = path.join(config.publicDir, originalFileName);
      await fs.copyFile(referenceImagePath, originalPublicPath);
      cleanupPaths.push(originalPublicPath);

      return {
        original: {
          filePath: originalPublicPath,
          publicUrl: `${config.baseUrl}/${originalFileName}`
        },
        cleanupPaths,
        debugPaths,
        blurSourcePath: referenceImagePath
      };
    }

    const flattenedDebugPath = this.createDebugPath(jobId, 'flattened-white', '.png');
    await this.converter.flattenImageOnSolidBackground({
      inputPath: referenceImagePath,
      outputPath: flattenedDebugPath,
      backgroundHex: 'FFFFFF'
    });

    debugPaths.flattenedReferencePng = flattenedDebugPath;

    const originalFileName = `seedance-ref-${jobId}.png`;
    const originalPublicPath = path.join(config.publicDir, originalFileName);
    await fs.copyFile(flattenedDebugPath, originalPublicPath);
    cleanupPaths.push(originalPublicPath);

      return {
        original: {
          filePath: originalPublicPath,
          publicUrl: `${config.baseUrl}/${originalFileName}`
        },
        cleanupPaths,
        debugPaths,
        blurSourcePath: flattenedDebugPath
      };
  }

  async ensureBlurVariant(jobId, referenceImagePath, cleanupPaths, { label, blur }) {
    const fileName = `seedance-ref-${jobId}-${label}.png`;
    const outputPath = path.join(config.publicDir, fileName);

    await this.converter.prepareBlurredImageReference({
      inputPath: referenceImagePath,
      outputPath,
      blur
    });

    cleanupPaths.push(outputPath);
    return {
      filePath: outputPath,
      publicUrl: `${config.baseUrl}/${fileName}`
    };
  }

  async buildEffectivePrompt({ promptMode, prompt, referenceImageUrl }) {
    if (!this.promptService) {
      return sanitizePrompt(prompt) || 'Using the reference image, preserve the same scene and add one subtle, believable motion for a short 3-second square sticker video.';
    }

    if (promptMode === 'random') {
      return this.promptService.createRandomPromptFromImage(referenceImageUrl);
    }

    return this.promptService.enhanceCustomPrompt(prompt);
  }

  async generateVideo({ jobId, referenceImagePath, promptMode = 'custom', prompt = '' }) {
    if (!this.provider) {
      throw new AppError('AI video generation provider is not configured.', 500);
    }

    if (!referenceImagePath) {
      throw new AppError('Reference image is required for AI video generation.', 400);
    }

    const {
      original,
      cleanupPaths,
      debugPaths,
      blurSourcePath
    } = await this.prepareReferenceVariants(jobId, referenceImagePath);
    const effectivePrompt = await this.buildEffectivePrompt({
      promptMode,
      prompt,
      referenceImageUrl: original.publicUrl
    });

    const attempts = [
      {
        label: 'original',
        referenceImageUrl: original.publicUrl
      }
    ];

    let lastError = null;

    for (const attempt of attempts) {
      const generatedVideoPath = this.storage.createGeneratedUploadPath(`${jobId}-${attempt.label}`, '.mp4');

      try {
        const generated = await this.provider.generate({
          prompt: effectivePrompt,
          referenceImageUrl: attempt.referenceImageUrl,
          outputPath: generatedVideoPath
        });

        debugPaths.seedanceOutputMp4 = generated.outputPath;

        return {
          outputPath: generated.outputPath,
          provider: generated.provider,
          model: generated.model,
          effectivePrompt,
          cleanupPaths: [...cleanupPaths],
          referenceImageUrl: attempt.referenceImageUrl,
          generatedSourcePath: generated.outputPath,
          debugPaths
        };
      } catch (error) {
        lastError = error;
        await this.storage.removeFile(generatedVideoPath);

        if (attempt.label === 'original' && isSensitiveModerationError(error)) {
          const soft = await this.ensureBlurVariant(jobId, blurSourcePath, cleanupPaths, {
            label: 'soft',
            blur: SOFT_BLUR
          });
          attempts.push({
            label: 'soft',
            referenceImageUrl: soft.publicUrl
          });
          continue;
        }

        if (attempt.label === 'soft' && isSensitiveModerationError(error)) {
          const medium = await this.ensureBlurVariant(jobId, blurSourcePath, cleanupPaths, {
            label: 'medium',
            blur: MEDIUM_BLUR
          });
          attempts.push({
            label: 'medium',
            referenceImageUrl: medium.publicUrl
          });
          continue;
        }

        if (attempt.label === 'medium' && isSensitiveModerationError(error)) {
          const hard = await this.ensureBlurVariant(jobId, blurSourcePath, cleanupPaths, {
            label: 'hard',
            blur: HARD_BLUR
          });
          attempts.push({
            label: 'hard',
            referenceImageUrl: hard.publicUrl
          });
          continue;
        }
      }
    }

    throw lastError || new AppError('AI video generation failed.', 500);
  }
}
