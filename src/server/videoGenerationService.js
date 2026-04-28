import path from 'node:path';
import { promises as fs } from 'node:fs';
import { config } from '../config/env.js';
import { AppError } from '../utils/errors.js';

const SOFT_BLUR = '6:3';
const MEDIUM_BLUR = '8:3';
const HARD_BLUR = '10:3';
const DEFAULT_CHROMA_KEY = {
  backgroundHex: '00FF00',
  similarity: 0.35,
  blur: SOFT_BLUR,
  blend: 0
};
const SEEDANCE_RATIOS = [
  { value: '21:9', ratio: 21 / 9 },
  { value: '16:9', ratio: 16 / 9 },
  { value: '4:3', ratio: 4 / 3 },
  { value: '1:1', ratio: 1 },
  { value: '3:4', ratio: 3 / 4 },
  { value: '9:16', ratio: 9 / 16 }
];

function sanitizePrompt(value) {
  return String(value || '').trim();
}

function isSensitiveModerationError(error) {
  return /sensitive information/i.test(String(error?.message || ''));
}

function pickCropSafeSeedanceRatio(width, height) {
  const sourceRatio = width / height;
  const isSquare = Math.abs(sourceRatio - 1) < 0.02;
  if (isSquare) {
    return '1:1';
  }

  const cropSafeCandidates = SEEDANCE_RATIOS.filter((candidate) => (
    sourceRatio > 1
      ? candidate.ratio <= sourceRatio && candidate.ratio >= 1
      : candidate.ratio >= sourceRatio && candidate.ratio <= 1
  ));
  const candidates = cropSafeCandidates.length ? cropSafeCandidates : SEEDANCE_RATIOS;
  const selected = candidates.reduce((best, candidate) => {
    const distance = Math.abs(Math.log(sourceRatio / candidate.ratio));
    return distance < best.distance ? { ...candidate, distance } : best;
  }, { ...candidates[0], distance: Infinity });

  return selected.value;
}

function parseRatioValue(ratio) {
  const [width, height] = String(ratio || '').split(':').map(Number);
  return width > 0 && height > 0 ? width / height : 1;
}

function normalizeChromaKey(value) {
  const backgroundHex = String(value?.backgroundHex || DEFAULT_CHROMA_KEY.backgroundHex)
    .replace(/^#/, '')
    .trim()
    .toUpperCase();
  const similarity = Number(value?.similarity);

  return {
    backgroundHex: /^[0-9A-F]{6}$/.test(backgroundHex) ? backgroundHex : DEFAULT_CHROMA_KEY.backgroundHex,
    similarity: Number.isFinite(similarity) && similarity > 0
      ? Math.max(0.30, similarity)
      : DEFAULT_CHROMA_KEY.similarity,
    blur: /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(String(value?.blur || ''))
      ? String(value.blur)
      : DEFAULT_CHROMA_KEY.blur,
    blend: DEFAULT_CHROMA_KEY.blend
  };
}

function buildChromaPromptSuffix(chromaKey) {
  return ` If the reference image has a bright solid #${chromaKey.backgroundHex} background, keep that exact #${chromaKey.backgroundHex} background color flat and unchanged throughout the clip so it can be removed cleanly afterward.`;
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

  async prepareReferenceVariants(jobId, referenceImagePath, { promptMode = 'custom', prompt = '' } = {}) {
    const cleanupPaths = [];
    const debugPaths = {
      originalInputPng: null,
      flattenedReferencePng: null,
      croppedReferencePng: null,
      seedanceOutputMp4: null,
      chromakeyOutputWebm: null,
      aiVideoPlanJson: null,
      chromaKey: null
    };

    const inputStream = await this.converter.probeVisualStream(referenceImagePath);
    const seedanceRatio = inputStream.width > 0 && inputStream.height > 0
      ? pickCropSafeSeedanceRatio(inputStream.width, inputStream.height)
      : config.acedataVideoRatio;
    const seedanceRatioValue = parseRatioValue(seedanceRatio);
    const inputHasAlpha = await this.converter.hasAlphaChannel(referenceImagePath);
    const originalDebugPath = this.createDebugPath(jobId, 'original-input', '.png');
    await fs.copyFile(referenceImagePath, originalDebugPath);
    debugPaths.originalInputPng = originalDebugPath;

    if (!inputHasAlpha) {
      const croppedDebugPath = this.createDebugPath(jobId, `cropped-${seedanceRatio.replace(':', 'x')}`, '.png');
      await this.converter.cropImageToAspectRatio({
        inputPath: referenceImagePath,
        outputPath: croppedDebugPath,
        targetRatio: seedanceRatioValue
      });
      debugPaths.croppedReferencePng = croppedDebugPath;

      const originalFileName = `seedance-ref-${jobId}.png`;
      const originalPublicPath = path.join(config.publicDir, originalFileName);
      await fs.copyFile(croppedDebugPath, originalPublicPath);
      cleanupPaths.push(originalPublicPath);

      return {
        original: {
          filePath: originalPublicPath,
          publicUrl: `${config.baseUrl}/${originalFileName}`
        },
        seedanceRatio,
        cleanupPaths,
        debugPaths,
        blurSourcePath: croppedDebugPath,
      usesChromaKey: false,
      chromaBlur: DEFAULT_CHROMA_KEY.blur,
      plannedMotionPrompt: null
      };
    }

    const chromaAnalysisFileName = `seedance-chroma-source-${jobId}.png`;
    const chromaAnalysisPublicPath = path.join(config.publicDir, chromaAnalysisFileName);
    await fs.copyFile(referenceImagePath, chromaAnalysisPublicPath);
    cleanupPaths.push(chromaAnalysisPublicPath);

    const aiVideoPlan = this.promptService?.createAiVideoPlanFromImage
      ? await this.promptService.createAiVideoPlanFromImage(`${config.baseUrl}/${chromaAnalysisFileName}`, {
          promptMode,
          prompt: promptMode === 'random' ? '' : prompt,
          level: promptMode === 'random' ? Number(prompt) || null : null
        })
      : null;
    const chromaKey = normalizeChromaKey(aiVideoPlan?.chromaKey);
    debugPaths.chromaKey = chromaKey;
    const planDebugPath = this.createDebugPath(jobId, 'ai-video-plan', '.json');
    await fs.writeFile(
      planDebugPath,
      JSON.stringify({
        motionPrompt: aiVideoPlan?.motionPrompt || null,
        chromaKey: {
          backgroundHex: chromaKey.backgroundHex,
          similarity: chromaKey.similarity,
          blur: chromaKey.blur
        },
        rawPlan: aiVideoPlan || null
      }, null, 2),
      'utf8'
    );
    debugPaths.aiVideoPlanJson = planDebugPath;

    const flattenedDebugPath = this.createDebugPath(jobId, `flattened-${chromaKey.backgroundHex.toLowerCase()}`, '.png');
    await this.converter.flattenImageOnSolidBackground({
      inputPath: referenceImagePath,
      outputPath: flattenedDebugPath,
      backgroundHex: chromaKey.backgroundHex
    });

    debugPaths.flattenedReferencePng = flattenedDebugPath;

    const croppedDebugPath = this.createDebugPath(jobId, `cropped-${seedanceRatio.replace(':', 'x')}`, '.png');
    await this.converter.cropImageToAspectRatio({
      inputPath: flattenedDebugPath,
      outputPath: croppedDebugPath,
      targetRatio: seedanceRatioValue
    });
    debugPaths.croppedReferencePng = croppedDebugPath;

    const originalFileName = `seedance-ref-${jobId}.png`;
    const originalPublicPath = path.join(config.publicDir, originalFileName);
    await fs.copyFile(croppedDebugPath, originalPublicPath);
    cleanupPaths.push(originalPublicPath);

    return {
      original: {
        filePath: originalPublicPath,
        publicUrl: `${config.baseUrl}/${originalFileName}`
      },
      seedanceRatio,
      cleanupPaths,
      debugPaths,
      blurSourcePath: croppedDebugPath,
      usesChromaKey: true,
      chromaKey,
      chromaBlur: chromaKey.blur,
      plannedMotionPrompt: aiVideoPlan?.motionPrompt || null
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
      return sanitizePrompt(prompt) || 'Using the reference image, preserve the same scene and add one subtle, believable motion for a short 3-second sticker video.';
    }

    if (promptMode === 'random') {
      return this.promptService.createRandomPromptFromImage(referenceImageUrl, {
        level: Number(prompt) || null
      });
    }

    return this.promptService.enhanceCustomPrompt(prompt);
  }

  addChromaPromptGuard(prompt, usesChromaKey, chromaKey = DEFAULT_CHROMA_KEY) {
    const base = sanitizePrompt(prompt);
    if (!usesChromaKey) {
      return base;
    }

    return `${base || 'Animate the reference as a short 3-second sticker clip.'}${buildChromaPromptSuffix(chromaKey)}`;
  }

  async resolveSeedanceRatio(referenceImagePath) {
    try {
      const stream = await this.converter.probeVisualStream(referenceImagePath);
      if (stream.width > 0 && stream.height > 0) {
        return pickCropSafeSeedanceRatio(stream.width, stream.height);
      }
    } catch {
      // Fall back to the configured ratio if probing fails.
    }

    return config.acedataVideoRatio;
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
      seedanceRatio,
      cleanupPaths,
      debugPaths,
      blurSourcePath,
      usesChromaKey,
      chromaKey,
      chromaBlur,
      plannedMotionPrompt
    } = await this.prepareReferenceVariants(jobId, referenceImagePath, { promptMode, prompt });
    const motionPrompt = plannedMotionPrompt || await this.buildEffectivePrompt({
      promptMode,
      prompt,
      referenceImageUrl: original.publicUrl
    });
    const effectivePrompt = this.addChromaPromptGuard(motionPrompt, usesChromaKey, chromaKey);

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
          outputPath: generatedVideoPath,
          ratio: seedanceRatio
        });

        debugPaths.seedanceOutputMp4 = generated.outputPath;

        let finalOutputPath = generated.outputPath;
        if (usesChromaKey) {
          finalOutputPath = this.createDebugPath(jobId, 'chromakey-alpha', '.webm');
          await this.converter.removeChromaBackgroundFromVideo({
            inputPath: generated.outputPath,
            outputPath: finalOutputPath,
            colorHex: chromaKey.backgroundHex,
            similarity: chromaKey.similarity,
            blend: chromaKey.blend
          });
          debugPaths.chromakeyOutputWebm = finalOutputPath;
        }

        return {
          outputPath: finalOutputPath,
          provider: generated.provider,
          model: generated.model,
          seedanceRatio: generated.ratio || seedanceRatio,
          effectivePrompt,
          cleanupPaths: [...cleanupPaths],
          referenceImageUrl: attempt.referenceImageUrl,
          generatedSourcePath: finalOutputPath,
          debugPaths
        };
      } catch (error) {
        lastError = error;
        await this.storage.removeFile(generatedVideoPath);

        if (attempt.label === 'original' && isSensitiveModerationError(error)) {
          const soft = await this.ensureBlurVariant(jobId, blurSourcePath, cleanupPaths, {
            label: 'soft',
            blur: chromaBlur || SOFT_BLUR
          });
          attempts.push({
            label: 'soft',
            referenceImageUrl: soft.publicUrl
          });
          continue;
        }

        if (attempt.label === 'soft' && isSensitiveModerationError(error)) {
          break;
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
