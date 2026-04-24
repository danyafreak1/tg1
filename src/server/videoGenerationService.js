import path from 'node:path';
import { promises as fs } from 'node:fs';
import { config } from '../config/env.js';
import { AppError } from '../utils/errors.js';

const SOFT_BLUR = '6:2';

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

  async prepareReferenceVariants(jobId, referenceImagePath) {
    const originalFileName = `seedance-ref-${jobId}.png`;
    const originalPublicPath = path.join(config.publicDir, originalFileName);
    await fs.copyFile(referenceImagePath, originalPublicPath);

    return {
      original: {
        filePath: originalPublicPath,
        publicUrl: `${config.baseUrl}/${originalFileName}`
      },
      cleanupPaths: [originalPublicPath]
    };
  }

  async ensureSoftBlurVariant(jobId, referenceImagePath, cleanupPaths) {
    const fileName = `seedance-ref-${jobId}-soft.png`;
    const outputPath = path.join(config.publicDir, fileName);

    await this.converter.prepareBlurredImageReference({
      inputPath: referenceImagePath,
      outputPath,
      blur: SOFT_BLUR
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

    const { original, cleanupPaths } = await this.prepareReferenceVariants(jobId, referenceImagePath);
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

        return {
          outputPath: generated.outputPath,
          provider: generated.provider,
          model: generated.model,
          effectivePrompt,
          cleanupPaths: [...cleanupPaths],
          referenceImageUrl: attempt.referenceImageUrl
        };
      } catch (error) {
        lastError = error;
        await this.storage.removeFile(generatedVideoPath);

        if (attempt.label === 'original' && isSensitiveModerationError(error)) {
          const soft = await this.ensureSoftBlurVariant(jobId, referenceImagePath, cleanupPaths);
          attempts.push({
            label: 'soft',
            referenceImageUrl: soft.publicUrl
          });
          continue;
        }
      }
    }

    throw lastError || new AppError('AI video generation failed.', 500);
  }
}
