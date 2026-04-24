import { config } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { AcedataSeedanceVideoProvider } from './acedataSeedanceProvider.js';

export function createVideoProvider(providerName = config.videoProvider) {
  switch ((providerName || '').toLowerCase()) {
    case '':
      return null;
    case 'acedata-seedance':
    case 'acedata':
    case 'seedance':
      return new AcedataSeedanceVideoProvider({
        apiKey: config.acedataVideoApiKey,
        baseUrl: config.acedataVideoBaseUrl,
        model: config.acedataVideoModel,
        ratio: config.acedataVideoRatio,
        resolution: config.acedataVideoResolution,
        generateAudio: config.acedataVideoGenerateAudio,
        watermark: config.acedataVideoWatermark,
        cameraFixed: config.acedataVideoCameraFixed,
        returnLastFrame: config.acedataVideoReturnLastFrame,
        duration: config.acedataVideoDurationSec
      });
    default:
      throw new AppError(`Unsupported VIDEO_PROVIDER: ${providerName}`, 500);
  }
}
