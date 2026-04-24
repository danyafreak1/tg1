import { config } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { ByteplusImageProvider } from './byteplusProvider.js';
import { MockImageProvider } from './mockProvider.js';
import { OpenAiImageProvider } from './openAiProvider.js';
import { WebhookImageProvider } from './webhookProvider.js';

export function createImageProvider(providerName = config.imageProvider) {
  switch ((providerName || '').toLowerCase()) {
    case 'mock':
      return new MockImageProvider();
    case 'openai':
      return new OpenAiImageProvider({
        apiKey: config.openAiImageApiKey,
        baseUrl: config.openAiImageBaseUrl,
        model: config.openAiImageModel
      });
    case 'byteplus':
      return new ByteplusImageProvider({
        apiKey: config.byteplusArkApiKey,
        baseUrl: config.byteplusArkBaseUrl,
        model: config.byteplusImageModel
      });
    case 'webhook':
      return new WebhookImageProvider({
        endpoint: config.imageProviderWebhookUrl
      });
    default:
      throw new AppError(`Unsupported IMAGE_PROVIDER: ${providerName}`, 500);
  }
}
