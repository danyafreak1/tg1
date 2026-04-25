import { config } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { promises as fs } from 'node:fs';

export class AcedataSeedanceVideoProvider {
  constructor({
    apiKey = config.acedataVideoApiKey,
    baseUrl = config.acedataVideoBaseUrl,
    model = config.acedataVideoModel,
    resolution = config.acedataVideoResolution,
    ratio = config.acedataVideoRatio,
    generateAudio = config.acedataVideoGenerateAudio,
    watermark = config.acedataVideoWatermark,
    cameraFixed = config.acedataVideoCameraFixed,
    returnLastFrame = config.acedataVideoReturnLastFrame,
    duration = config.acedataVideoDurationSec
  } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.model = model;
    this.ratio = ratio;
    this.resolution = resolution;
    this.generateAudio = generateAudio;
    this.watermark = watermark;
    this.cameraFixed = cameraFixed;
    this.returnLastFrame = returnLastFrame;
    this.duration = duration;
  }

  buildRequestBody({ prompt, imageUrl = null, referenceImageUrl = null, ratio = null }) {
    const resolvedImageUrl = referenceImageUrl || imageUrl;
    const resolvedRatio = ratio || this.ratio;
    const content = [];

    if (resolvedImageUrl) {
      content.push({
        type: 'image_url',
        image_url: {
          url: resolvedImageUrl
        }
      });
    }

    if (prompt) {
      content.push({
        type: 'text',
        text: prompt
      });
    }

    return {
      content,
      generate_audio: this.generateAudio,
      model: this.model,
      ratio: resolvedRatio,
      watermark: this.watermark,
      resolution: this.resolution,
      camerafixed: this.cameraFixed,
      return_last_frame: this.returnLastFrame,
      duration: this.duration
    };
  }

  async generate({ prompt, imageUrl = null, referenceImageUrl = null, outputPath, ratio = null }) {
    if (!outputPath) {
      throw new AppError('Output path is required for Seedance generation.', 500);
    }

    const requestBody = this.buildRequestBody({
      prompt,
      imageUrl,
      referenceImageUrl,
      ratio
    });

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const rawBody = await response.text();
    let payload = null;

    try {
      payload = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const message =
        payload?.message ||
        payload?.error?.message ||
        payload?.error?.details ||
        payload?.details ||
        rawBody ||
        'Seedance request failed.';
      throw new AppError(message, response.status);
    }

    const entry = Array.isArray(payload?.data) ? payload.data[0] : payload?.data;
    const videoUrl =
      entry?.content?.video_url ||
      entry?.video_url ||
      payload?.video_url ||
      payload?.content?.video_url ||
      null;

    if (!videoUrl) {
      throw new AppError('Seedance did not return a video URL.', 502);
    }

    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
      throw new AppError(`Unable to download generated video: ${videoResponse.status}`, 502);
    }

    const buffer = Buffer.from(await videoResponse.arrayBuffer());
    await fs.writeFile(outputPath, buffer);

    return {
      outputPath,
      taskId: payload?.task_id || null,
      provider: 'acedata-seedance',
      model: entry?.model || this.model,
      ratio: requestBody.ratio,
      moderationStatus: entry?.status || null
    };
  }
}
