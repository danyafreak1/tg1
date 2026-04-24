import dotenv from 'dotenv';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

dotenv.config();

const rootDir = process.cwd();
const dataDir = path.join(rootDir, 'data');
const uploadsDir = path.join(rootDir, 'uploads');
const outputsDir = path.join(rootDir, 'outputs');
const publicDir = path.join(rootDir, 'public');
const chatSystemPromptPath = process.env.CHAT_SYSTEM_PROMPT_PATH
  ? path.resolve(process.env.CHAT_SYSTEM_PROMPT_PATH)
  : path.join(dataDir, 'chat-system-prompt.txt');

for (const dir of [dataDir, uploadsDir, outputsDir, publicDir]) {
  mkdirSync(dir, { recursive: true });
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value, fallback = false) {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

export const config = {
  rootDir,
  dataDir,
  uploadsDir,
  outputsDir,
  publicDir,
  chatSystemPromptPath,
  port: toNumber(process.env.PORT, 3000),
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  botToken: process.env.BOT_TOKEN || '',
  adminToken: process.env.ADMIN_TOKEN || '',
  chatModel: process.env.CHAT_MODEL || 'deepseek-chat',
  chatPrimaryModel: process.env.CHAT_PRIMARY_MODEL || '',
  chatPrimaryApiKey: process.env.CHAT_PRIMARY_API_KEY || '',
  chatPrimaryBaseUrl: (process.env.CHAT_PRIMARY_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  chatFallbackModel: process.env.CHAT_FALLBACK_MODEL || '',
  chatFallbackApiKey: process.env.CHAT_FALLBACK_API_KEY || '',
  chatFallbackBaseUrl: (process.env.CHAT_FALLBACK_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  promptEnhancerEnabled: toBoolean(process.env.PROMPT_ENHANCER_ENABLED, false),
  promptEnhancerApiKey: process.env.PROMPT_ENHANCER_API_KEY || process.env.OPENAI_API_KEY || '',
  promptEnhancerBaseUrl: (process.env.PROMPT_ENHANCER_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  promptEnhancerModel: process.env.PROMPT_ENHANCER_MODEL || process.env.CHAT_MODEL || 'deepseek-chat',
  imageProvider: (process.env.IMAGE_PROVIDER || 'mock').toLowerCase(),
  imageProviderWebhookUrl: process.env.IMAGE_PROVIDER_WEBHOOK_URL || '',
  imageGenerationTimeoutMs: toNumber(process.env.IMAGE_GENERATION_TIMEOUT_MS, 120_000),
  chatRequestTimeoutMs: toNumber(process.env.CHAT_REQUEST_TIMEOUT_MS, 30_000),
  videoProvider: (process.env.VIDEO_PROVIDER || '').toLowerCase(),
  videoGenerationTimeoutMs: toNumber(process.env.VIDEO_GENERATION_TIMEOUT_MS, 300_000),
  aiVideoTokenCost: toNumber(process.env.AI_VIDEO_TOKEN_COST, 1),
  initialAiVideoTokens: toNumber(process.env.INITIAL_AI_VIDEO_TOKENS, 0),
  openAiApiKey: process.env.OPENAI_API_KEY || '',
  openAiBaseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  openAiImageApiKey: process.env.OPENAI_IMAGE_API_KEY || process.env.OPENAI_API_KEY || '',
  openAiImageBaseUrl: (process.env.OPENAI_IMAGE_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  openAiImageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-4.1',
  acedataVideoApiKey: process.env.ACEDATA_VIDEO_API_KEY || '',
  acedataVideoBaseUrl: (process.env.ACEDATA_VIDEO_BASE_URL || 'https://api.acedata.cloud/seedance/videos').replace(/\/+$/, ''),
  acedataVideoModel: process.env.ACEDATA_VIDEO_MODEL || 'doubao-seedance-1-0-pro-fast-251015',
  acedataVideoRatio: process.env.ACEDATA_VIDEO_RATIO || '1:1',
  acedataVideoResolution: process.env.ACEDATA_VIDEO_RESOLUTION || '480p',
  acedataVideoGenerateAudio: toBoolean(process.env.ACEDATA_VIDEO_GENERATE_AUDIO, false),
  acedataVideoWatermark: toBoolean(process.env.ACEDATA_VIDEO_WATERMARK, false),
  acedataVideoCameraFixed: toBoolean(process.env.ACEDATA_VIDEO_CAMERA_FIXED, true),
  acedataVideoReturnLastFrame: toBoolean(process.env.ACEDATA_VIDEO_RETURN_LAST_FRAME, false),
  acedataVideoDurationSec: toNumber(process.env.ACEDATA_VIDEO_DURATION_SEC, 3),
  byteplusArkApiKey: process.env.BYTEPLUS_ARK_API_KEY || '',
  byteplusArkBaseUrl: process.env.BYTEPLUS_ARK_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3',
  byteplusImageModel: process.env.BYTEPLUS_IMAGE_MODEL || 'seededit-3-0-i2i-250628',
  maxUploadMb: toNumber(process.env.MAX_UPLOAD_MB, 20),
  maxInputDurationSec: toNumber(process.env.MAX_INPUT_DURATION_SEC, 60),
  outputTtlMinutes: toNumber(process.env.OUTPUT_TTL_MINUTES, 60),
  maxConcurrentJobs: toNumber(process.env.MAX_CONCURRENT_JOBS, 2),
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
  stickerDurationLimitSec: 3,
  stickerFrameRateLimit: 30,
  stickerSidePx: 512,
  stickerMaxSizeBytes: 256 * 1024,
  ffmpegTimeoutMs: 45_000
};

config.chatProviders = [
  config.chatPrimaryModel && config.chatPrimaryApiKey
    ? {
        name: 'primary',
        model: config.chatPrimaryModel,
        apiKey: config.chatPrimaryApiKey,
        baseUrl: config.chatPrimaryBaseUrl
      }
    : null,
  {
    name: config.chatPrimaryModel && config.chatPrimaryApiKey ? 'fallback' : 'default',
    model: config.chatFallbackModel || config.chatModel,
    apiKey: config.chatFallbackApiKey || config.openAiApiKey,
    baseUrl: config.chatFallbackBaseUrl || config.openAiBaseUrl
  }
].filter((provider) => provider && provider.model && provider.apiKey);
