import { createServer } from 'node:http';
import { config } from './config/env.js';
import { StorageService } from './storage/storageService.js';
import { TelegramStickerConverter } from './converter/telegramStickerConverter.js';
import { JobQueue } from './queue/jobQueue.js';
import { BackendService } from './server/backendService.js';
import { createApp } from './server/createApp.js';
import { createBot } from './bot/createBot.js';
import { UserStateRepository } from './storage/userStateRepository.js';
import { StickerSetService } from './bot/stickerSetService.js';
import { createImageProvider } from './integrations/imageProviders/index.js';
import { ImageGenerationService } from './server/imageGenerationService.js';
import { ChatPromptService } from './server/chatPromptService.js';
import { ChatCompletionService } from './server/chatCompletionService.js';
import { PromptEnhancementService } from './server/promptEnhancementService.js';

const storage = new StorageService();
await storage.init();
const chatPromptService = new ChatPromptService();
await chatPromptService.ensurePromptFile();
const chatCompletionService = new ChatCompletionService({
  chatPromptService
});
const promptEnhancementService = new PromptEnhancementService();

const converter = new TelegramStickerConverter();
const imageGenerationService = new ImageGenerationService({
  storage,
  provider: createImageProvider(),
  promptEnhancer: promptEnhancementService
});
const backend = new BackendService({
  storage,
  converter,
  queue: null,
  imageGenerationService
});

const queue = new JobQueue({
  concurrency: config.maxConcurrentJobs,
  worker: (job) => backend.handleJob(job)
});
backend.queue = queue;

setInterval(() => {
  storage.cleanup(backend.jobs, config.outputTtlMinutes).catch((error) => {
    console.error('cleanup error', error);
  });
}, 60_000).unref();

const userState = new UserStateRepository();
const stickerSets = config.botToken
  ? new StickerSetService({
      token: config.botToken,
      botUsername: 'funchu_bot'
    })
  : null;

const app = createApp({
  backend,
  storage,
  publicDir: config.publicDir,
  userState,
  stickerSets
});

const server = createServer(app);
server.listen(config.port, () => {
  console.log(`Server listening on ${config.baseUrl}`);
});

const botModule = await createBot({
  backend,
  storage,
  userState,
  chatCompletionService
});

if (botModule) {
  if (botModule.bot?.botInfo?.username && stickerSets) {
    stickerSets.botUsername = botModule.bot.botInfo.username;
  }
  await botModule.launch();
  console.log('Telegram bot started in polling mode.');
} else {
  console.log('BOT_TOKEN not set. Server started without Telegram bot.');
}

const shutdown = async (signal) => {
  console.log(`Received ${signal}, shutting down...`);
  server.close();
  if (botModule) {
    await botModule.stop(signal);
  }
  process.exit(0);
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
