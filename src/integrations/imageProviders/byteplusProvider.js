import { promises as fs } from 'node:fs';
import { config } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { getMimeTypeFromPath } from '../../utils/mime.js';

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new AppError('BytePlus image generation timed out.', 504);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class ByteplusImageProvider {
  constructor({ apiKey, baseUrl, model }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.model = model;
  }

  async generate({ prompt, sourceImagePath, outputPath }) {
    if (!this.apiKey) {
      throw new AppError('BYTEPLUS_ARK_API_KEY is not configured.', 500);
    }

    let imageDataUrl = null;
    if (sourceImagePath) {
      const imageBuffer = await fs.readFile(sourceImagePath);
      const mimeType = getMimeTypeFromPath(sourceImagePath);
      imageDataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
    }

    const response = await fetchWithTimeout(`${this.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        ...(imageDataUrl ? { image: imageDataUrl } : {}),
        response_format: 'url',
        size: 'adaptive',
        watermark: false
      })
    }, config.imageGenerationTimeoutMs);

    const data = await response.json();
    if (!response.ok) {
      throw new AppError(data.error?.message || data.message || 'BytePlus image generation failed.', 502);
    }

    const imageUrl = data?.data?.[0]?.url;
    if (!imageUrl) {
      throw new AppError('BytePlus did not return an image URL.', 502);
    }

    const imageResponse = await fetchWithTimeout(imageUrl, {}, config.imageGenerationTimeoutMs);
    if (!imageResponse.ok) {
      throw new AppError('BytePlus returned an unreadable image URL.', 502);
    }

    const generatedBuffer = Buffer.from(await imageResponse.arrayBuffer());
    await fs.writeFile(outputPath, generatedBuffer);

    return {
      outputPath,
      mimeType: imageResponse.headers.get('content-type') || 'image/jpeg',
      revisedPrompt: null,
      provider: 'byteplus'
    };
  }
}
