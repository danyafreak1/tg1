import { AppError } from '../utils/errors.js';

export class ImageGenerationService {
  constructor({ storage, provider, promptEnhancer = null }) {
    this.storage = storage;
    this.provider = provider;
    this.promptEnhancer = promptEnhancer;
  }

  async generateImage({ jobId, sourceImagePath = null, prompt }) {
    if (!prompt?.trim()) {
      throw new AppError('Prompt is required for image generation.', 400);
    }

    const enhancedPrompt = this.promptEnhancer
      ? await this.promptEnhancer.enhance({
          prompt: prompt.trim(),
          sourceImagePath
        })
      : prompt.trim();

    if (enhancedPrompt === 'REFUSE') {
      throw new AppError('Запрос нельзя безопасно преобразовать в изображение.', 400);
    }

    const generatedPath = this.storage.createGeneratedUploadPath(jobId, '.png');
    const result = await this.provider.generate({
      prompt: enhancedPrompt,
      sourceImagePath,
      outputPath: generatedPath
    });

    return {
      ...result,
      generatedSourcePath: generatedPath,
      originalName: result.originalName || 'generated.png',
      prompt,
      effectivePrompt: enhancedPrompt
    };
  }
}
