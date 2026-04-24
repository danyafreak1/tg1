import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Telegraf, Markup } from 'telegraf';
import { config } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { createId } from '../utils/ids.js';
import { StickerSetService } from './stickerSetService.js';

const DEFAULT_EMOJI = '🫥';

function helpText(baseUrl) {
  return [
    'Я принимаю видео и картинки и конвертирую их в Telegram-compatible stickers.',
    '',
    'Команды:',
    '/start - краткое приветствие',
    '/help - помощь',
    '/pay - открыть мини-приложение оплаты',
    '/gen - сгенерировать стикер по prompt',
    '/sets - ваши наборы, созданные этим ботом',
    '/newpack - создать новый набор из последнего готового стикера',
    '/add - добавить последний готовый стикер в существующий набор',
    '',
    `Web UI: ${baseUrl}`
  ].join('\n');
}

function buildResultKeyboard(userId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('AI Video Sticker', `aivideofromlast:${userId}`)],
    [
      Markup.button.callback('Create New Pack', `newpack:${userId}`),
      Markup.button.callback('Add To Existing', `addexisting:${userId}`)
    ]
  ]);
}

function buildCornerChoiceKeyboard(userId, mode) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('⬜ Обычные углы', `packcorners:${userId}:${mode}:normal`),
      Markup.button.callback('◼ Скруглённые углы', `packcorners:${userId}:${mode}:rounded`)
    ]
  ]);
}

function buildPaymentUrl(userId) {
  const params = new URLSearchParams({
    user_id: String(userId)
  });
  return `${config.baseUrl}/payment.html?${params.toString()}`;
}

function buildPaymentKeyboard(userId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.webApp('Open Payment Mini App', buildPaymentUrl(userId))
    ]
  ]);
}

function extractMedia(message) {
  if (message.sticker) {
    if (message.sticker.is_animated) {
      return null;
    }

    return {
      fileId: message.sticker.file_id,
      fileName: message.sticker.is_video ? 'telegram-sticker.webm' : 'telegram-sticker.webp',
      inputType: message.sticker.is_video ? 'video' : 'image',
      readyStickerFormat: message.sticker.is_video ? 'video' : 'static'
    };
  }

  if (message.photo?.length) {
    const photo = message.photo[message.photo.length - 1];
    return {
      fileId: photo.file_id,
      fileName: 'telegram-photo.jpg',
      inputType: 'image',
      readyStickerFormat: null
    };
  }

  if (message.video) {
    return {
      fileId: message.video.file_id,
      fileName: message.video.file_name || 'telegram-video.mp4',
      inputType: 'video',
      readyStickerFormat: null
    };
  }

  if (message.video_note) {
    return {
      fileId: message.video_note.file_id,
      fileName: 'video-note.mp4',
      inputType: 'video',
      readyStickerFormat: null
    };
  }

  if (!message.document) {
    return null;
  }

  const fileName = message.document.file_name || 'document.bin';
  const mimeType = message.document.mime_type || '';
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith('.webp') || mimeType === 'image/webp') {
    return {
      fileId: message.document.file_id,
      fileName,
      inputType: 'image',
      readyStickerFormat: 'static'
    };
  }

  if (lowerName.endsWith('.webm') || mimeType === 'video/webm') {
    return {
      fileId: message.document.file_id,
      fileName,
      inputType: 'video',
      readyStickerFormat: 'video'
    };
  }

  const isVideo = mimeType.startsWith('video/') || /\.(mp4|mov|mkv|avi)$/i.test(lowerName);
  const isImage = mimeType.startsWith('image/') || /\.(png|jpg|jpeg)$/i.test(lowerName);

  if (isVideo) {
    return {
      fileId: message.document.file_id,
      fileName,
      inputType: 'video',
      readyStickerFormat: null
    };
  }

  if (isImage) {
    return {
      fileId: message.document.file_id,
      fileName,
      inputType: 'image',
      readyStickerFormat: null
    };
  }

  return null;
}

async function downloadTelegramFile(ctx, storage, media) {
  const fileUrl = await ctx.telegram.getFileLink(media.fileId);
  const response = await fetch(fileUrl.toString());

  if (!response.ok) {
    throw new AppError('Failed to download file from Telegram.');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const uploadPath = storage.createUploadPath(media.fileName);
  await fs.writeFile(uploadPath, buffer);
  return uploadPath;
}

function buildPackTitle(title, botUsername) {
  const suffix = ` | @${botUsername}`;
  const trimmedTitle = title.trim().replace(/\s+\|\s+@\w+$/i, '');
  const maxBaseLength = 64 - suffix.length;
  const safeBase = trimmedTitle.slice(0, Math.max(1, maxBaseLength)).trim() || 'Sticker Pack';
  return `${safeBase}${suffix}`;
}

function transliterateCyrillic(input) {
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
    щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
  };

  return input
    .normalize('NFKC')
    .split('')
    .map((char) => {
      const lower = char.toLowerCase();
      return Object.prototype.hasOwnProperty.call(map, lower) ? map[lower] : char;
    })
    .join('');
}

function buildPackShortNameBase(title) {
  const transliterated = transliterateCyrillic(title);
  const normalizedTitle = transliterated
    .toLowerCase()
    .replace(/[^a-z0-9_ -]+/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  const safeTitle = normalizedTitle || 'pack';
  return /^[a-z]/.test(safeTitle) ? safeTitle : `pack_${safeTitle}`;
}

function parsePackInput(input) {
  const [titleRaw, emojiRaw] = input.split('|').map((item) => item.trim());
  if (!titleRaw) {
    throw new AppError('Отправьте только название набора, например: Funny Cats');
  }

  return {
    title: titleRaw,
    emoji: emojiRaw || DEFAULT_EMOJI
  };
}

function buildStylePrompt(inputType) {
  return inputType === 'image'
    ? 'Как обработать картинку перед конвертацией?'
    : 'Как обработать видео перед конвертацией?';
}

function buildLayoutPrompt(inputType = 'video') {
  return inputType === 'image'
    ? 'В каком формате сохранить фото-стикер?'
    : 'В каком формате сохранить видео-стикер?';
}

function formatTokenWord(count) {
  const value = Math.abs(Number(count) || 0) % 100;
  const last = value % 10;
  if (value > 10 && value < 20) {
    return 'tokens';
  }
  if (last === 1) {
    return 'token';
  }
  if (last >= 2 && last <= 4) {
    return 'tokens';
  }
  return 'tokens';
}

function buildLayoutKeyboard({ userId, inputType, aiVideoTokens = 0 }) {
  const rows = [];

  if (inputType === 'image') {
    rows.push([
      Markup.button.callback(
        `AI Video Sticker - ${aiVideoTokens} ${formatTokenWord(aiVideoTokens)}`,
        `aivideo:${userId}`
      )
    ]);
  }

  rows.push([
    Markup.button.callback('1:1', `layout:${userId}:square`),
    Markup.button.callback('As Is', `layout:${userId}:original`)
  ]);

  return Markup.inlineKeyboard(rows);
}

function buildNewPackPreview({ title, shortName, botUsername, emoji }) {
  return [
    'Проверьте новый набор:',
    `Title: ${buildPackTitle(title, botUsername)}`,
    `Short name: ${shortName}_by_${botUsername.toLowerCase()}`,
    `Emoji: ${emoji}`
  ].join('\n');
}

function estimateWaitSeconds({ queueSize = 0, kind = 'generate' }) {
  const perJob = kind === 'generate'
    ? { min: 12, max: 25 }
    : { min: 6, max: 18 };

  return {
    min: perJob.min + queueSize * perJob.min,
    max: perJob.max + queueSize * perJob.max
  };
}

function buildQueuedStatusText({ queueSize = 0, kind = 'generate' }) {
  const estimate = estimateWaitSeconds({ queueSize, kind });
  const title = kind === 'generate' ? 'Генерация стикера' : 'Обработка файла';

  if (queueSize > 0) {
    return [
      `⏳ ${title}`,
      'Статус: в очереди',
      `Перед вами задач: ${queueSize}`,
      `Ожидание: примерно ${estimate.min}-${estimate.max} сек.`
    ].join('\n');
  }

  return [
    `⏳ ${title}`,
    'Статус: запущено',
    `Ожидание: примерно ${estimate.min}-${estimate.max} сек.`
  ].join('\n');
}

function buildProgressStatusText(job) {
  const title = job.jobType === 'generate_sticker' ? 'Генерация стикера' : 'Обработка файла';
  switch (job.progressStage) {
    case 'queued':
      return buildQueuedStatusText({
        queueSize: 0,
        kind: job.jobType === 'generate_sticker' ? 'generate' : 'convert'
      });
    case 'generating':
      return [`🎨 ${title}`, 'Статус: генерирую изображение'].join('\n');
    case 'converting':
      return [`🛠 ${title}`, 'Статус: конвертирую в стикер'].join('\n');
    case 'done':
      return [`✅ ${title}`, 'Статус: готово'].join('\n');
    case 'failed':
      return [`❌ ${title}`, `Статус: ошибка${job.error ? `\n${job.error}` : ''}`].join('\n');
    default:
      return [`⏳ ${title}`, 'Статус: выполняется'].join('\n');
  }
}

function buildStatusButtonLabel(job) {
  const iconByStage = {
    queued: '⏳',
    generating: '🎨',
    converting: '🛠',
    done: '✅',
    failed: '❌'
  };
  const textByStage = {
    queued: 'В очереди',
    generating: 'Генерирую',
    converting: 'Конвертирую',
    done: 'Готово',
    failed: 'Ошибка'
  };
  const icon = iconByStage[job.progressStage] || '⏳';
  const text = textByStage[job.progressStage] || 'Обрабатываю';
  return `${icon} ${text}`;
}

function buildStatusKeyboard(userId, job) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(buildStatusButtonLabel(job), `jobstatus:${userId}:${job.id}`)
    ]
  ]);
}

function isLikelyTextToImageRequest(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value) {
    return false;
  }

  return /(^|\s)(сгенерируй|создай|нарисуй|сделай|изобрази|покажи|generate|create|draw|render|imagine)\b/.test(value)
    && /(картин|изображен|арт|иллюстрац|стикер|image|picture|art|illustration|sticker)\b/.test(value);
}

async function replyInChunks(ctx, text, chunkSize = 4000) {
  const value = String(text || '').trim();
  if (!value) {
    return;
  }

  for (let index = 0; index < value.length; index += chunkSize) {
    await ctx.reply(value.slice(index, index + chunkSize));
  }
}

export async function createBot({ backend, storage, userState, chatCompletionService }) {
  if (!config.botToken) {
    return null;
  }

  const bot = new Telegraf(config.botToken);
  bot.catch((error, ctx) => {
    console.error('Telegram bot handler error', {
      updateType: ctx?.updateType,
      updateId: ctx?.update?.update_id,
      error
    });
  });
  const me = await bot.telegram.getMe();
  const stickerSets = new StickerSetService({
    token: config.botToken,
    botUsername: me.username
  });
  const statusMessages = new Map();

  async function syncUserProfile(ctx) {
    if (!ctx?.from?.id) {
      return;
    }

    await userState.updateUser(ctx.from.id, (current) => ({
      ...current,
      profile: {
        id: ctx.from.id,
        username: ctx.from.username || null,
        firstName: ctx.from.first_name || null,
        lastName: ctx.from.last_name || null,
        languageCode: ctx.from.language_code || null,
        updatedAt: new Date().toISOString()
      },
      balances: {
        aiVideoTokens: Number(current.balances?.aiVideoTokens ?? config.initialAiVideoTokens)
      }
    }));
  }

  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Start the bot' },
    { command: 'help', description: 'Show help and flow' },
    { command: 'pay', description: 'Open payment mini app' },
    { command: 'gen', description: 'Generate a sticker from prompt' },
    { command: 'sets', description: 'List your sticker sets created by this bot' },
    { command: 'newpack', description: 'Create a new sticker pack from the last sticker' },
    { command: 'add', description: 'Add the last sticker to an existing pack' }
  ]);

  async function rememberStatusMessage(chatId, jobId, messageId) {
    statusMessages.set(jobId, { chatId, messageId });
  }

  async function createStatusMessage(ctx) {
    return ctx.reply(
      '…',
      buildStatusKeyboard(ctx.from.id, {
        id: 'pending',
        progressStage: 'queued'
      })
    );
  }

  async function deleteMessageQuietly(chatId, messageId) {
    if (!messageId) {
      return;
    }

    try {
      await bot.telegram.deleteMessage(chatId, messageId);
    } catch {
      // ignore delete errors
    }
  }

  async function clearStatusMessage(jobId) {
    const target = statusMessages.get(jobId);
    if (!target) {
      return;
    }

    try {
      await bot.telegram.deleteMessage(
        target.chatId,
        target.messageId
      );
    } catch {
      // ignore edit errors
    }

    statusMessages.delete(jobId);
  }

  async function updateStatusMessage(job) {
    const target = statusMessages.get(job.id);
    if (!target) {
      return;
    }

    try {
      await bot.telegram.editMessageReplyMarkup(
        target.chatId,
        target.messageId,
        undefined,
        buildStatusKeyboard(job.owner?.userId, job).reply_markup
      );
    } catch {
      // ignore edit errors
    }
  }

  async function enqueuePromptOnlyGeneration(ctx, prompt, existingStatusMessageId = null) {
    const statusMessageId = existingStatusMessageId || (await createStatusMessage(ctx)).message_id;
    const job = await backend.createJobFromUpload({
      inputPath: null,
      originalName: 'prompt-only',
      source: 'bot',
      owner: {
        chatId: ctx.chat.id,
        userId: ctx.from.id
      },
      options: {
        jobType: 'generate_image',
        inputType: 'image',
        outputExtension: '.png',
        prompt
      }
    });
    await rememberStatusMessage(ctx.chat.id, job.id, statusMessageId);
    await updateStatusMessage(job);
  }

  async function enqueueConversionJob(ctx, payload, roundedCorners) {
    const statusMessage = await createStatusMessage(ctx);
    const job = await backend.createJobFromUpload({
      inputPath: payload.inputPath,
      originalName: payload.originalName,
      source: 'bot',
      owner: {
        chatId: ctx.chat.id,
        userId: ctx.from.id
      },
      options: {
        inputType: payload.inputType || 'video',
        roundedCorners,
        forceSquare: Boolean(payload.forceSquare)
      }
    });
    await rememberStatusMessage(ctx.chat.id, job.id, statusMessage.message_id);
    await updateStatusMessage(job);
  }

  async function promptForPackCorners(ctx, mode) {
    await ctx.reply(
      'Перед добавлением в набор выберите углы для стикера:',
      buildCornerChoiceKeyboard(ctx.from.id, mode)
    );
  }

  async function rebuildStaticStickerWithCorners(userId, roundedCorners) {
    const user = await userState.getUser(userId);
    const sourcePath = user.lastConverted?.sourcePath || user.lastConverted?.path;

    if (!sourcePath) {
      throw new AppError('Не найден исходный файл для переобработки стикера.');
    }

    const outputPath = storage.createOutputPath(createId('job_'), '.webp');
    await backend.converter.convert({
      inputPath: sourcePath,
      outputPath,
      inputType: 'image',
      roundedCorners,
      forceSquare: true
    });

    await userState.updateUser(userId, (current) => ({
      ...current,
      lastConverted: {
        ...current.lastConverted,
        path: outputPath,
        documentFileId: null,
        stickerFormat: 'static'
      }
    }));
  }

  async function prepareAiVideoReferenceFromLast(userId) {
    const user = await userState.getUser(userId);
    const sourcePath = user.lastConverted?.path;

    if (!sourcePath) {
      throw new AppError('No sticker available for AI video reference.');
    }

    const outputPath = storage.createUploadPath(`ai-video-reference-${path.basename(sourcePath, path.extname(sourcePath))}.png`);
    await backend.converter.prepareAiVideoReference({
      inputPath: sourcePath,
      outputPath
    });

    await userState.updateUser(userId, (current) => ({
      ...current,
      aiVideoDraft: {
        referenceImagePath: outputPath,
        sourceStickerPath: sourcePath,
        preparedAt: new Date().toISOString()
      }
    }));

    return { outputPath };
  }

  bot.start((ctx) => ctx.reply(helpText(config.baseUrl), buildPaymentKeyboard(ctx.from.id)));
  bot.help((ctx) => ctx.reply(helpText(config.baseUrl)));

  bot.command('pay', async (ctx) => {
    await syncUserProfile(ctx);
    await ctx.reply(
      'Откройте мини-приложение оплаты. Пока это заглушка с тарифами и кнопками без реального провайдера.',
      buildPaymentKeyboard(ctx.from.id)
    );
  });

  bot.command('gen', async (ctx) => {
    await syncUserProfile(ctx);
    const text = ctx.message.text.replace(/^\/gen(@\w+)?/i, '').trim();
    if (text) {
      await enqueuePromptOnlyGeneration(ctx, text);
      return;
    }

    await userState.updateUser(ctx.from.id, (current) => ({
      ...current,
      pendingAction: { type: 'generate_sticker_wait_prompt_only' }
    }));
    await ctx.reply('Пришлите prompt для text-to-image генерации, и я верну готовый стикер.');
  });

  bot.command('sets', async (ctx) => {
    await syncUserProfile(ctx);
    const user = await userState.getUser(ctx.from.id);
    if (!user.stickerSets.length) {
      await ctx.reply('Пока нет наборов, созданных этим ботом. Сначала конвертируйте видео или картинку.');
      return;
    }

    const lines = user.stickerSets.map((set, index) => `${index + 1}. ${set.title} - https://t.me/addstickers/${set.name}`);
    await ctx.reply(lines.join('\n'));
  });

  bot.command('newpack', async (ctx) => {
    await syncUserProfile(ctx);
    const text = ctx.message.text.replace(/^\/newpack(@\w+)?/i, '').trim();

    if (!text) {
      await promptForNewPackTitle(ctx);
      return;
    }

    await previewNewPack(ctx, text);
  });

  bot.command('add', async (ctx) => {
    await syncUserProfile(ctx);
    const text = ctx.message.text.replace(/^\/add(@\w+)?/i, '').trim();
    const user = await userState.getUser(ctx.from.id);
    if (!user.lastConverted?.path) {
      await ctx.reply('Сначала пришлите видео, картинку, .webp или .webm и дождитесь готового результата.');
      return;
    }

    if (!text) {
      if (!user.stickerSets.length) {
        await ctx.reply('Нет доступных наборов. Сначала создайте новый через /newpack.');
        return;
      }

      const keyboard = user.stickerSets.map((set, index) => [
        Markup.button.callback(`📦 ${set.title}`, `pickset:${ctx.from.id}:${index}`)
      ]);
      await ctx.reply('Выберите набор для добавления последнего стикера:', Markup.inlineKeyboard(keyboard));
      return;
    }

    await addToExistingSet(ctx, text, user.lastConverted.emoji || DEFAULT_EMOJI);
  });

  bot.on('callback_query', async (ctx) => {
    await syncUserProfile(ctx);
    const data = ctx.callbackQuery.data || '';
    const [action, ownerIdRaw, third, fourth] = data.split(':');
    const ownerId = Number(ownerIdRaw);

    if (action === 'jobstatus') {
      if (ctx.from.id !== ownerId) {
        await ctx.answerCbQuery('Эта кнопка не для вас.');
        return;
      }

      await ctx.answerCbQuery();
      return;
    }

    if (ctx.from.id !== ownerId) {
      await ctx.answerCbQuery('Эта кнопка не для вас.');
      return;
    }

    if (action === 'packcorners') {
      const mode = third;
      const roundedCorners = fourth === 'rounded';
      await ctx.editMessageReplyMarkup(undefined);
      await rebuildStaticStickerWithCorners(ctx.from.id, roundedCorners);

      const user = await userState.getUser(ctx.from.id);
      const pending = user.pendingAction;

      if (pending?.type === 'newpack_after_corners' && pending.payload?.text) {
        await userState.updateUser(ctx.from.id, (current) => ({
          ...current,
          pendingAction: null
        }));
        await previewNewPack(ctx, pending.payload.text);
        await ctx.answerCbQuery(roundedCorners ? 'Сделаю со скруглением.' : 'Оставлю обычные углы.');
        return;
      }

      if (pending?.type === 'add_after_corners' && pending.payload?.setName) {
        await userState.updateUser(ctx.from.id, (current) => ({
          ...current,
          pendingAction: null
        }));
        await addToExistingSet(ctx, pending.payload.setName, user.lastConverted?.emoji || DEFAULT_EMOJI);
        await ctx.answerCbQuery(roundedCorners ? 'Сделаю со скруглением.' : 'Оставлю обычные углы.');
        return;
      }

      if (mode === 'newpack') {
        await promptForNewPackTitle(ctx);
      } else {
        if (!user.stickerSets.length) {
          await ctx.reply('Нет доступных наборов. Сначала создайте новый через /newpack.');
        } else {
          const keyboard = user.stickerSets.map((set, index) => [
            Markup.button.callback(`📦 ${set.title}`, `pickset:${ctx.from.id}:${index}`)
          ]);
          await ctx.reply('Выберите набор для добавления последнего стикера:', Markup.inlineKeyboard(keyboard));
        }
      }

      await ctx.answerCbQuery(roundedCorners ? 'Сделаю со скруглением.' : 'Оставлю обычные углы.');
      return;
    }

    if (action === 'newpack') {
      await userState.updateUser(ctx.from.id, (current) => ({
        ...current,
        pendingAction: { type: 'newpack' }
      }));
      await ctx.editMessageReplyMarkup(undefined);
      await promptForNewPackTitle(ctx);
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'aivideo') {
      const user = await userState.getUser(ctx.from.id);
      const pending = user.pendingAction;
      const balance = Number(user.balances?.aiVideoTokens || 0);

      if (pending?.type !== 'choose_layout' || !pending.payload) {
        await ctx.answerCbQuery('Parameters not found.');
        return;
      }

      if ((pending.payload.inputType || 'image') !== 'image') {
        await ctx.answerCbQuery('AI video sticker works only for images.');
        return;
      }

      if (balance < config.aiVideoTokenCost) {
        await ctx.answerCbQuery('Not enough tokens.');
        await ctx.reply(
          `AI video sticker needs ${config.aiVideoTokenCost} ${formatTokenWord(config.aiVideoTokenCost)}. You now have ${balance} ${formatTokenWord(balance)}.`,
          buildPaymentKeyboard(ctx.from.id)
        );
        return;
      }

      await ctx.answerCbQuery('AI video sticker will be added soon.');
      await ctx.reply(
        `AI video sticker is already present in the flow. You have ${balance} ${formatTokenWord(balance)}. Tokens will be charged only when the real generation backend is connected.`,
        buildPaymentKeyboard(ctx.from.id)
      );
      return;
    }

    if (action === 'aivideofromlast') {
      const user = await userState.getUser(ctx.from.id);
      const balance = Number(user.balances?.aiVideoTokens || 0);

      if (!user.lastConverted?.path) {
        await ctx.answerCbQuery('No sticker available.');
        return;
      }

      if (balance < config.aiVideoTokenCost) {
        await ctx.answerCbQuery('Not enough tokens.');
        await ctx.reply(
          `AI video sticker needs ${config.aiVideoTokenCost} ${formatTokenWord(config.aiVideoTokenCost)}. You now have ${balance} ${formatTokenWord(balance)}.`,
          buildPaymentKeyboard(ctx.from.id)
        );
        return;
      }

      const prepared = await prepareAiVideoReferenceFromLast(ctx.from.id);

      try {
        await bot.telegram.sendPhoto(ctx.chat.id, {
          source: prepared.outputPath,
          filename: path.basename(prepared.outputPath)
        });
      } catch {}

      await ctx.answerCbQuery('Reference frame ready.');
      await ctx.reply('PNG reference frame is ready. For WebM the bot first extracts frame 1. If the image is too small, it is upscaled so at least one side reaches 300 px. AI video generation will be connected next.');
      return;
    }

    if (action === 'layout') {
      const forceSquare = third === 'square';
      const user = await userState.getUser(ctx.from.id);
      const pending = user.pendingAction;

      if (pending?.type !== 'choose_layout' || !pending.payload) {
        await ctx.answerCbQuery('Параметры формата не найдены.');
        return;
      }

      await userState.updateUser(ctx.from.id, (current) => ({
        ...current,
        pendingAction: {
          type: 'choose_style',
          payload: {
            ...pending.payload,
            forceSquare
          }
        }
      }));

      await deleteMessageQuietly(ctx.chat.id, ctx.callbackQuery.message?.message_id);
      await ctx.reply(
        buildStylePrompt(pending.payload.inputType || 'video'),
        Markup.inlineKeyboard([
          [
            Markup.button.callback('⬜ Обычные углы', `style:${ctx.from.id}:normal`),
            Markup.button.callback('◼ Скруглённые углы', `style:${ctx.from.id}:rounded`)
          ]
        ])
      );
      await ctx.answerCbQuery(forceSquare ? 'Сделаю 1:1.' : 'Сохраню как есть.');
      return;
    }

    if (action === 'style') {
      const roundedCorners = third === 'rounded';
      const user = await userState.getUser(ctx.from.id);
      const pending = user.pendingAction;

      if (pending?.type !== 'choose_style' || !pending.payload) {
        await ctx.answerCbQuery('Файл для обработки не найден.');
        return;
      }

      await userState.updateUser(ctx.from.id, (current) => ({
        ...current,
        pendingAction: null
      }));

      await deleteMessageQuietly(ctx.chat.id, ctx.callbackQuery.message?.message_id);
      await enqueueConversionJob(ctx, pending.payload, roundedCorners);
      await ctx.answerCbQuery(roundedCorners ? 'Сделаю со скруглением.' : 'Сделаю обычный вариант.');
      return;
    }

    if (action === 'confirmnewpack') {
      const user = await userState.getUser(ctx.from.id);
      const pending = user.pendingAction;
      if (pending?.type !== 'confirm_newpack' || !pending.payload) {
        await ctx.answerCbQuery('Нет данных для создания набора.');
        await promptForNewPackTitle(ctx);
        return;
      }

      await ctx.editMessageReplyMarkup(undefined);
      await createNewPackFromPending(ctx, pending.payload);
      await ctx.answerCbQuery('Создаю набор...');
      return;
    }

    if (action === 'editnewpack') {
      await userState.updateUser(ctx.from.id, (current) => ({
        ...current,
        pendingAction: { type: 'newpack' }
      }));
      await ctx.editMessageReplyMarkup(undefined);
      await promptForNewPackTitle(ctx);
      await ctx.answerCbQuery('Введите новое название.');
      return;
    }

    if (action === 'addexisting') {
      const user = await userState.getUser(ctx.from.id);
      if (!user.stickerSets.length) {
        await ctx.answerCbQuery('Сначала создайте набор.');
        await ctx.reply('Нет доступных наборов. Используйте /newpack.');
        return;
      }

      const keyboard = user.stickerSets.map((set, index) => [
        Markup.button.callback(`📦 ${set.title}`, `pickset:${ctx.from.id}:${index}`)
      ]);
      await ctx.editMessageReplyMarkup(undefined);
      await ctx.reply('Выберите набор:', Markup.inlineKeyboard(keyboard));
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'pickset') {
      const user = await userState.getUser(ctx.from.id);
      const set = user.stickerSets[Number(third)];
      if (!set) {
        await ctx.answerCbQuery('Набор не найден.');
        return;
      }

      await deleteMessageQuietly(ctx.chat.id, ctx.callbackQuery.message?.message_id);
      await addToExistingSet(ctx, set.name, user.lastConverted?.emoji || DEFAULT_EMOJI);
      await ctx.answerCbQuery('Стикер добавляется...');
    }
  });

  bot.on('text', async (ctx, next) => {
    await syncUserProfile(ctx);
    if (!ctx.message.text.startsWith('/')) {
      const user = await userState.getUser(ctx.from.id);

      if (user.pendingAction?.type === 'generate_sticker_wait_prompt_only') {
        const prompt = ctx.message.text.trim();
        if (!prompt) {
          await ctx.reply('Нужен непустой prompt.');
          return;
        }

        await userState.updateUser(ctx.from.id, (current) => ({
          ...current,
          pendingAction: null
        }));
        await enqueuePromptOnlyGeneration(ctx, prompt);
        return;
      }

      if (user.pendingAction?.type === 'generate_sticker_wait_prompt') {
        const prompt = ctx.message.text.trim();
        if (!prompt) {
          await ctx.reply('Нужен непустой prompt.');
          return;
        }

        const payload = user.pendingAction.payload;
        await userState.updateUser(ctx.from.id, (current) => ({
          ...current,
          pendingAction: null
        }));

        const statusMessage = await ctx.reply(
          '…',
          buildStatusKeyboard(ctx.from.id, {
            id: 'pending',
            progressStage: 'queued'
          })
        );
        const job = await backend.createJobFromUpload({
          inputPath: payload.inputPath,
          originalName: payload.originalName,
          source: 'bot',
          owner: {
            chatId: ctx.chat.id,
            userId: ctx.from.id
          },
          options: {
            jobType: 'generate_sticker',
            inputType: 'image',
            outputExtension: '.webp',
            prompt,
            roundedCorners: false,
            forceSquare: true
          }
        });
        await rememberStatusMessage(ctx.chat.id, job.id, statusMessage.message_id);
        await updateStatusMessage(job);
        return;
      }

      if (user.pendingAction?.type === 'newpack') {
        await previewNewPack(ctx, ctx.message.text);
        return;
      }

      if (chatCompletionService) {
        const provisionalStatusMessage = isLikelyTextToImageRequest(ctx.message.text)
          ? await createStatusMessage(ctx)
          : null;

        try {
          await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
          const reply = await chatCompletionService.reply({
            message: ctx.message.text,
            history: user.chatHistory || []
          });

          await userState.updateUser(ctx.from.id, (current) => ({
            ...current,
            chatHistory: reply.nextHistory
          }));

          if (reply.mode === 'generate_image') {
            await enqueuePromptOnlyGeneration(ctx, reply.prompt, provisionalStatusMessage?.message_id || null);
            return;
          }

          await deleteMessageQuietly(ctx.chat.id, provisionalStatusMessage?.message_id);
          await replyInChunks(ctx, reply.answer);
          return;
        } catch (error) {
          const timedOut = /timed out/i.test(String(error?.message || ''));
          if (timedOut && provisionalStatusMessage?.message_id) {
            await enqueuePromptOnlyGeneration(
              ctx,
              ctx.message.text,
              provisionalStatusMessage.message_id
            );
            return;
          }

          await deleteMessageQuietly(ctx.chat.id, provisionalStatusMessage?.message_id);
          console.error('chat provider error', error);
          await ctx.reply(`Не удалось получить ответ: ${error.message}`);
          return;
        }
      }
    }

    return next();
  });

  bot.on('message', async (ctx, next) => {
    await syncUserProfile(ctx);
    const user = await userState.getUser(ctx.from.id);
    const media = extractMedia(ctx.message);
    if (!media) {
      return next();
    }

    try {
      if (user.pendingAction?.type === 'generate_sticker_wait_image') {
        if (media.inputType !== 'image') {
          await ctx.reply('Для генерации нужен именно image input. Пришлите картинку и затем prompt.');
          return;
        }

        const inputPath = await downloadTelegramFile(ctx, storage, media);
        await userState.updateUser(ctx.from.id, (current) => ({
          ...current,
          pendingAction: {
            type: 'generate_sticker_wait_prompt',
            payload: {
              inputPath,
              originalName: media.fileName
            }
          }
        }));
        await ctx.reply('Теперь пришлите prompt для генератора. Я использую текущий backend image provider и верну готовый стикер.');
        return;
      }

      const inputPath = await downloadTelegramFile(ctx, storage, media);

      if (media.readyStickerFormat) {
        await userState.updateUser(ctx.from.id, (current) => ({
          ...current,
          pendingAction: null,
          lastConverted: {
            path: inputPath,
            jobId: null,
            emoji: DEFAULT_EMOJI,
            stickerFormat: media.readyStickerFormat,
            sourcePath: inputPath,
            sourceOriginalName: media.fileName,
            documentFileId: media.fileId,
            readyAt: new Date().toISOString()
          }
        }));

        await ctx.reply(
          `Файл ${media.readyStickerFormat === 'static' ? '.webp' : '.webm'} уже подходит для Telegram. Можно сразу добавить его в набор.`,
          buildResultKeyboard(ctx.from.id)
        );
        return;
      }

      if (media.inputType === 'video') {
        await userState.updateUser(ctx.from.id, (current) => ({
          ...current,
          pendingAction: {
            type: 'choose_layout',
            payload: {
              inputPath,
              originalName: media.fileName,
              inputType: media.inputType
            }
          }
        }));

        await ctx.reply(
          buildLayoutPrompt('video'),
          buildLayoutKeyboard({
            userId: ctx.from.id,
            inputType: 'video',
            aiVideoTokens: user.balances?.aiVideoTokens || 0
          })
        );
      } else {
        await userState.updateUser(ctx.from.id, (current) => ({
          ...current,
          pendingAction: {
            type: 'choose_layout',
            payload: {
              inputPath,
              originalName: media.fileName,
              inputType: media.inputType,
              forceSquare: false
            }
          }
        }));

        await ctx.reply(
          buildLayoutPrompt('image'),
          buildLayoutKeyboard({
            userId: ctx.from.id,
            inputType: 'image',
            aiVideoTokens: user.balances?.aiVideoTokens || 0
          })
        );
      }
    } catch (error) {
      await ctx.reply(`Не удалось принять файл: ${error.message}`);
    }
  });

  backend.on('job.updated', async ({ job, internalJob }) => {
    if (internalJob.source !== 'bot' || !internalJob.owner) {
      return;
    }

    await updateStatusMessage(job);
  });

  backend.on('job.done', async ({ internalJob }) => {
    if (internalJob.source !== 'bot' || !internalJob.owner) {
      return;
    }

    await clearStatusMessage(internalJob.id);

    if (internalJob.jobType === 'generate_image') {
      await userState.updateUser(internalJob.owner.userId, (current) => ({
        ...current,
        pendingAction: {
          type: 'choose_layout',
          payload: {
            inputPath: internalJob.outputPath,
            originalName: internalJob.originalName || 'generated.png',
            inputType: 'image',
            forceSquare: false
          }
        }
      }));

      try {
        await bot.telegram.sendPhoto(
          internalJob.owner.chatId,
          {
            source: internalJob.outputPath,
            filename: path.basename(internalJob.outputPath)
          }
        );
      } catch {
        // ignore preview send errors and continue with the normal flow
      }

      await bot.telegram.sendMessage(
        internalJob.owner.chatId,
        buildLayoutPrompt('image'),
        buildLayoutKeyboard({
          userId: internalJob.owner.userId,
          inputType: 'image',
          aiVideoTokens: (await userState.getUser(internalJob.owner.userId)).balances?.aiVideoTokens || 0
        })
      );
      return;
    }

    const absolutePath = internalJob.outputPath;
    const stickerFormat = internalJob.result?.format || 'video';

    try {
      const sentSticker = await bot.telegram.sendSticker(
        internalJob.owner.chatId,
        {
          source: absolutePath,
          filename: path.basename(absolutePath)
        },
        {
          ...buildResultKeyboard(internalJob.owner.userId)
        }
      );

      await userState.updateUser(internalJob.owner.userId, (current) => ({
        ...current,
        lastConverted: {
          path: absolutePath,
          jobId: internalJob.id,
          emoji: DEFAULT_EMOJI,
          stickerFormat,
          sourcePath: internalJob.generatedSourcePath || internalJob.inputPath || absolutePath,
          sourceOriginalName: internalJob.originalName,
          documentFileId: sentSticker.sticker?.file_id || null,
          readyAt: new Date().toISOString()
        }
      }));
    } catch (error) {
      await bot.telegram.sendMessage(
        internalJob.owner.chatId,
        `Конвертация завершилась, но отправка в Telegram не удалась: ${error.message}`
      );
    }
  });

  backend.on('job.failed', async ({ internalJob, job }) => {
    if (internalJob.source !== 'bot' || !internalJob.owner) {
      return;
    }

    await clearStatusMessage(internalJob.id);

    await bot.telegram.sendMessage(
      internalJob.owner.chatId,
      `Конвертация не удалась: ${job.error}`
    );
  });

  async function promptForNewPackTitle(ctx) {
    await userState.updateUser(ctx.from.id, (current) => ({
      ...current,
      pendingAction: { type: 'newpack' }
    }));
    await ctx.reply(`Пришлите только название набора.\nЯ сам сделаю title вида "Name | @${me.username}" и short_name по правилам Telegram.`);
  }

  async function previewNewPack(ctx, input) {
    const user = await userState.getUser(ctx.from.id);
    if (!user.lastConverted?.path) {
      await ctx.reply('Сначала пришлите видео, картинку, .webp или .webm и дождитесь результата.');
      return;
    }

    try {
      const parsed = parsePackInput(input);
      const shortName = buildPackShortNameBase(parsed.title);
      const payload = {
        title: parsed.title,
        shortName,
        emoji: parsed.emoji || DEFAULT_EMOJI
      };

      await userState.updateUser(ctx.from.id, (current) => ({
        ...current,
        pendingAction: {
          type: 'confirm_newpack',
          payload
        }
      }));

      await ctx.reply(
        buildNewPackPreview({
          title: parsed.title,
          shortName,
          botUsername: me.username,
          emoji: payload.emoji
        }),
        Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Подтвердить', `confirmnewpack:${ctx.from.id}`),
            Markup.button.callback('✏️ Изменить', `editnewpack:${ctx.from.id}`)
          ]
        ])
      );
    } catch (error) {
      await ctx.reply(`Не удалось подготовить набор: ${error.message}`);
      await promptForNewPackTitle(ctx);
    }
  }

  async function createNewPackFromPending(ctx, payload) {
    const user = await userState.getUser(ctx.from.id);
    if (!user.lastConverted?.path) {
      await promptForNewPackTitle(ctx);
      return;
    }

    try {
      const created = await stickerSets.createNewSet({
        userId: ctx.from.id,
        title: buildPackTitle(payload.title, me.username),
        shortName: payload.shortName,
        emoji: payload.emoji || DEFAULT_EMOJI,
        stickerPath: user.lastConverted.path,
        stickerFormat: user.lastConverted.stickerFormat || 'video',
        stickerFileId: user.lastConverted.documentFileId || null
      });

      await userState.updateUser(ctx.from.id, (current) => ({
        ...current,
        pendingAction: null,
        lastConverted: {
          ...current.lastConverted,
          emoji: payload.emoji || DEFAULT_EMOJI
        },
        stickerSets: [
          ...current.stickerSets.filter((set) => set.name !== created.name),
          {
            name: created.name,
            title: created.title,
            createdAt: new Date().toISOString(),
            stickers: [
              {
                fileId: created.fileId,
                sourceOriginalName: current.lastConverted?.sourceOriginalName || current.lastConverted?.path || null,
                sourceJobId: current.lastConverted?.jobId || null,
                addedAt: new Date().toISOString()
              }
            ]
          }
        ]
      }));

      await ctx.reply(`Новый набор создан: ${created.addUrl}`);
    } catch (error) {
      await userState.updateUser(ctx.from.id, (current) => ({
        ...current,
        pendingAction: { type: 'newpack' }
      }));
      await ctx.reply(`Не удалось создать набор: ${error.message}`);
      await promptForNewPackTitle(ctx);
    }
  }

  async function addToExistingSet(ctx, setName, emoji) {
    const user = await userState.getUser(ctx.from.id);
    if (!user.lastConverted?.path) {
      await ctx.reply('Нет последнего готового стикера. Сначала пришлите видео, картинку, .webp или .webm.');
      return;
    }

    try {
      const added = await stickerSets.addToSet({
        userId: ctx.from.id,
        setName,
        emoji: emoji || DEFAULT_EMOJI,
        stickerPath: user.lastConverted.path,
        stickerFormat: user.lastConverted.stickerFormat || 'video',
        stickerFileId: user.lastConverted.documentFileId || null
      });

      await userState.updateUser(ctx.from.id, (current) => ({
        ...current,
        stickerSets: (current.stickerSets || []).map((set) => {
          if (set.name !== setName) {
            return set;
          }

          return {
            ...set,
            stickers: [
              ...(set.stickers || []),
              {
                fileId: added.fileId,
                sourceOriginalName: current.lastConverted?.sourceOriginalName || current.lastConverted?.path || null,
                sourceJobId: current.lastConverted?.jobId || null,
                addedAt: new Date().toISOString()
              }
            ]
          };
        })
      }));

      await ctx.reply(`Стикер добавлен в набор: ${added.addUrl}`);
    } catch (error) {
      await ctx.reply(`Не удалось добавить стикер: ${error.message}`);
    }
  }

  return {
    bot,
    launch: async () => bot.launch(),
    stop: async (reason) => bot.stop(reason)
  };
}
