import { config } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';

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

  buildRequestBody({ prompt, imageUrl = null, referenceImageUrl = null }) {
    const resolvedImageUrl = referenceImageUrl || imageUrl;
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
      ratio: this.ratio,
      watermark: this.watermark,
      resolution: this.resolution,
      camerafixed: this.cameraFixed,
      return_last_frame: this.returnLastFrame,
      duration: this.duration
    };
  }

  async generate() {
    throw new AppError('Acedata Seedance base is prepared, but live video generation is not wired into the app flow yet.', 501);
  }
}
