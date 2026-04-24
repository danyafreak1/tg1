import { promises as fs } from 'node:fs';
import { config } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';

const GENERATION_RETRIES = 3;
const RETRY_DELAY_MS = 1200;

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new AppError('OpenAI image generation timed out.', 504);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class OpenAiImageProvider {
  constructor({ apiKey, baseUrl, model }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.model = model;
  }

  async downloadImageTo(outputPath, url) {
    const response = await fetchWithTimeout(url, {
      method: 'GET'
    }, config.imageGenerationTimeoutMs);

    if (!response.ok) {
      throw new AppError('Image provider returned an invalid image URL.', 502);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(outputPath, buffer);
  }

  async generateViaImagesEndpoint({ prompt, outputPath }) {
    let lastError = null;

    for (let attempt = 0; attempt < GENERATION_RETRIES; attempt += 1) {
      const response = await fetchWithTimeout(`${this.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          prompt,
          size: '1024x1024'
        })
      }, config.imageGenerationTimeoutMs);

      const data = await response.json();
      if (response.ok) {
        const imageUrl = data?.data?.[0]?.url;
        if (!imageUrl) {
          throw new AppError('Image provider did not return an image URL.', 502);
        }

        await this.downloadImageTo(outputPath, imageUrl);

        return {
          outputPath,
          mimeType: 'image/png',
          revisedPrompt: prompt,
          provider: 'openai-compatible-images'
        };
      }

      lastError = data.error?.message || 'Image generation failed.';
      if (attempt < GENERATION_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
      }
    }

    throw new AppError(lastError || 'Image generation failed.', 502);
  }

  async generate({ prompt, sourceImagePath, outputPath }) {
    if (!this.apiKey) {
      throw new AppError('OPENAI image API key is not configured.', 500);
    }

    if (sourceImagePath) {
      throw new AppError('This image provider is currently configured only for text-to-image generation.', 400);
    }

    if (this.baseUrl.includes('api.xinjianya.top') || this.model === 'grok-imagine-image-lite') {
      return this.generateViaImagesEndpoint({ prompt, outputPath });
    }

    const content = [{ type: 'input_text', text: prompt }];

    const response = await fetchWithTimeout(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        input: [
          {
            role: 'user',
            content
          }
        ],
        tools: [{ type: 'image_generation' }]
      })
    }, config.imageGenerationTimeoutMs);

    const data = await response.json();
    if (!response.ok) {
      throw new AppError(data.error?.message || 'OpenAI image generation failed.', 502);
    }

    const imageCall = Array.isArray(data.output)
      ? data.output.find((item) => item.type === 'image_generation_call' && typeof item.result === 'string')
      : null;

    if (!imageCall?.result) {
      throw new AppError('OpenAI did not return an image.', 502);
    }

    await fs.writeFile(outputPath, Buffer.from(imageCall.result, 'base64'));

    return {
      outputPath,
      mimeType: 'image/png',
      revisedPrompt: imageCall.revised_prompt || null,
      provider: 'openai'
    };
  }
}
