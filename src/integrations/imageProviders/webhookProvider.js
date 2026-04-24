import { promises as fs } from 'node:fs';
import { config } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new AppError('Image provider request timed out.', 504);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class WebhookImageProvider {
  constructor({ endpoint }) {
    this.endpoint = endpoint;
  }

  async generate({ prompt, sourceImagePath, outputPath }) {
    if (!this.endpoint) {
      throw new AppError('IMAGE_PROVIDER_WEBHOOK_URL is not configured.', 500);
    }

    const form = new FormData();
    form.append('prompt', prompt);
    if (sourceImagePath) {
      const imageBuffer = await fs.readFile(sourceImagePath);
      form.append('image', new Blob([imageBuffer]), 'source.png');
    }

    const response = await fetchWithTimeout(this.endpoint, {
      method: 'POST',
      body: form
    }, config.imageGenerationTimeoutMs);

    if (!response.ok) {
      throw new AppError(`Webhook image provider failed with status ${response.status}.`, 502);
    }

    const data = await response.json();
    if (typeof data.image_base64 === 'string') {
      await fs.writeFile(outputPath, Buffer.from(data.image_base64, 'base64'));
      return {
        outputPath,
        mimeType: data.mime_type || 'image/png',
        revisedPrompt: data.revised_prompt || null,
        provider: 'webhook'
      };
    }

    if (typeof data.image_url === 'string') {
      const imageResponse = await fetchWithTimeout(data.image_url, {}, config.imageGenerationTimeoutMs);
      if (!imageResponse.ok) {
        throw new AppError('Webhook provider returned an unreadable image_url.', 502);
      }

      const buffer = Buffer.from(await imageResponse.arrayBuffer());
      await fs.writeFile(outputPath, buffer);
      return {
        outputPath,
        mimeType: imageResponse.headers.get('content-type') || data.mime_type || 'image/png',
        revisedPrompt: data.revised_prompt || null,
        provider: 'webhook'
      };
    }

    throw new AppError('Webhook provider must return image_base64 or image_url.', 502);
  }
}
