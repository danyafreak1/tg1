import path from 'node:path';
import { promises as fs } from 'node:fs';
import { Telegraf, Markup } from 'telegraf';
import { config } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { createId } from '../utils/ids.js';
import { StickerSetService } from './stickerSetService.js';

const DEFAULT_EMOJI = String.fromCodePoint(0x1FAE5);
const STAR_TOKEN_PACKAGES = [1, 3, 5, 10, 25];

function helpText(baseUrl) {
  return [
    'Я принимаю видео и картинки и конвертирую их в Telegram-compatible stickers.',
    '',
    'Команды:',
    '/start - краткое приветствие',
    '/help - помощь',
    '/pay - buy AI video tokens with Telegram Stars',
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

function buildStarsPackageLabel(amount) {
  const tokenWord = amount === 1 ? 'Token' : 'Tokens';
  return `${amount} ${tokenWord} - ${amount} ${String.fromCodePoint(0x2B50)}`;
}

function buildStarsPaymentKeyboard(userId) {
  return Markup.inlineKeyboard(
    [1, 3, 5, 10, 25].map((amount) => [
      Markup.button.callback(buildStarsPackageLabel(amount), `buytokens:${userId}:${amount}`)
    ])
  );
}

function buildBuyTokensText(balance) {
  return [
    `AI video sticker needs ${config.aiVideoTokenCost} ${formatTokenWord(config.aiVideoTokenCost)}. You now have ${balance} ${formatTokenWord(balance)}.`,
    '',
    'Buy tokens with Telegram Stars:'
  ].join('\n');
}

function buildLanguageKeyboard(userId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Русский', `setlang:${userId}:ru`),
      Markup.button.callback('English', `setlang:${userId}:en`)
    ]
  ]);
}

function buildLanguagePrompt() {
  return [
    'Choose your language / Выберите язык',
    '',
    'You can change it later with /language.'
  ].join('\n');
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
    '\u0430': 'a', '\u0431': 'b', '\u0432': 'v', '\u0433': 'g', '\u0434': 'd', '\u0435': 'e', '\u0451': 'e', '\u0436': 'zh', '\u0437': 'z',
    '\u0438': 'i', '\u0439': 'y', '\u043a': 'k', '\u043b': 'l', '\u043c': 'm', '\u043d': 'n', '\u043e': 'o', '\u043f': 'p', '\u0440': 'r',
    '\u0441': 's', '\u0442': 't', '\u0443': 'u', '\u0444': 'f', '\u0445': 'h', '\u0446': 'ts', '\u0447': 'ch', '\u0448': 'sh',
    '\u0449': 'sch', '\u044a': '', '\u044b': 'y', '\u044c': '', '\u044d': 'e', '\u044e': 'yu', '\u044f': 'ya'
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

function buildAiVideoPromptModeKeyboard(userId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✍️ Ввести prompt', `aivideomode:${userId}:custom`)],
    [Markup.button.callback('🎲 Случайный', `aivideomode:${userId}:random`)]
  ]);
}

function buildAiVideoPromptInputKeyboard(userId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🎲 Использовать случайный prompt', `aivideorandomfromprompt:${userId}`)]
  ]);
}

function buildNewPackPreview({ title, shortName, botUsername, emoji }) {
  return [
    'Проверьте новый набор:',
    `Title: ${buildPackTitle(title, botUsername)}`,
    `Short name: ${shortName}_by_${botUsername.toLowerCase()}`,
    `Emoji: ${emoji}`
  ].join('\n');
}

function looksLikeMojibake(value) {
  const text = String(value || '');
  return /Р|Ð|Ñ|вЂ|Ѓ|Ћ|Ў|В°|С•|С—/.test(text);
}

function deriveStickerSetTitle(name) {
  const base = String(name || '')
    .replace(/_by_[a-z0-9_]+$/i, '')
    .replace(/_+/g, ' ')
    .trim();

  if (!base) {
    return 'Sticker Pack';
  }

  return base
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getStickerSetDisplayTitle(set) {
  const title = String(set?.title || '').trim();
  if (!title || looksLikeMojibake(title)) {
    return deriveStickerSetTitle(set?.name);
  }
  return title;
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

    const inferredLanguage = String(ctx.from.language_code || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';

    await userState.updateUser(ctx.from.id, (current) => ({
      ...current,
      profile: {
        id: ctx.from.id,
        username: ctx.from.username || null,
        firstName: ctx.from.first_name || null,
        lastName: ctx.from.last_name || null,
        languageCode: ctx.from.language_code || null,
        selectedLanguage: current.profile?.selectedLanguage || inferredLanguage,
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
    { command: 'language', description: 'Choose bot language' },
    { command: 'pay', description: 'Buy AI video tokens with Stars' },
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

  async function prepareAiVideoReferenceDraft(userId, sourcePath, extra = {}) {
    if (!sourcePath) {
      throw new AppError('No image available for AI video reference.');
    }

    const outputPath = storage.createUploadPath(`ai-video-reference-${path.basename(sourcePath, path.extname(sourcePath))}.png`);
    await backend.converter.prepareAiVideoReference({
      inputPath: sourcePath,
      outputPath
    });

    const draft = {
      referenceImagePath: outputPath,
      sourcePath,
      sourceStickerPath: extra.sourceStickerPath || null,
      sourceOriginalName: extra.sourceOriginalName || path.basename(sourcePath),
      preparedAt: new Date().toISOString()
    };

    await userState.updateUser(userId, (current) => ({
      ...current,
      aiVideoDraft: draft
    }));

    return draft;
  }

  async function prepareAiVideoReferenceFromLast(userId) {
    const user = await userState.getUser(userId);
    const sourcePath = user.lastConverted?.path;

    if (!sourcePath) {
      throw new AppError('No sticker available for AI video reference.');
    }

    return prepareAiVideoReferenceDraft(userId, sourcePath, {
      sourceStickerPath: sourcePath,
      sourceOriginalName: user.lastConverted?.sourceOriginalName || path.basename(sourcePath)
    });
  }

  async function createAdminThumbnailFromSticker(stickerPath) {
    const fileName = `admin-thumb-${createId('st_')}.png`;
    const outputPath = path.join(config.publicDir, fileName);
    await backend.converter.prepareAdminThumbnail({
      inputPath: stickerPath,
      outputPath,
      maxSide: 50
    });

    return {
      outputPath,
      publicUrl: `${config.baseUrl}/${fileName}`
    };
  }

  async function grantAiVideoTokens(userId, tokenAmount) {
    let nextBalance = config.initialAiVideoTokens;

    await userState.updateUser(userId, (current) => {
      const currentBalance = Number(current.balances?.aiVideoTokens || 0);
      nextBalance = currentBalance + tokenAmount;

      return {
        ...current,
        balances: {
          ...current.balances,
          aiVideoTokens: nextBalance
        }
      };
    });

    return nextBalance;
  }

  async function spendAiVideoTokens(userId, tokenAmount) {
    let nextBalance = 0;
    let spent = false;

    await userState.updateUser(userId, (current) => {
      const currentBalance = Number(current.balances?.aiVideoTokens || 0);
      if (currentBalance < tokenAmount) {
        nextBalance = currentBalance;
        return current;
      }

      spent = true;
      nextBalance = currentBalance - tokenAmount;
      return {
        ...current,
        balances: {
          ...current.balances,
          aiVideoTokens: nextBalance
        }
      };
    });

    if (!spent) {
      throw new AppError('Not enough AI video tokens.');
    }

    return nextBalance;
  }

  async function setAiVideoChargePending(userId, charge) {
    await userState.updateUser(userId, (current) => ({
      ...current,
      aiVideoChargePending: charge
    }));
  }

  async function clearAiVideoChargePending(userId, jobId = null) {
    await userState.updateUser(userId, (current) => {
      if (jobId && current.aiVideoChargePending?.jobId !== jobId) {
        return current;
      }

      return {
        ...current,
        aiVideoChargePending: null
      };
    });
  }

  async function confirmAiVideoCharge(userId, jobId) {
    let nextBalance = 0;
    let applied = false;

    await userState.updateUser(userId, (current) => {
      const pending = current.aiVideoChargePending;
      if (!pending || pending.jobId !== jobId) {
        nextBalance = Number(current.balances?.aiVideoTokens || 0);
        return current;
      }

      const currentBalance = Number(current.balances?.aiVideoTokens || 0);
      const amount = Number(pending.amount || 0);
      nextBalance = Math.max(0, currentBalance - amount);
      applied = true;

      return {
        ...current,
        aiVideoChargePending: null,
        balances: {
          ...current.balances,
          aiVideoTokens: nextBalance
        }
      };
    });

    return { nextBalance, applied };
  }

  function getAvailableAiVideoTokens(user) {
    const balance = Number(user?.balances?.aiVideoTokens || 0);
    const pending = Number(user?.aiVideoChargePending?.amount || 0);
    return Math.max(0, balance - pending);
  }

  async function promptForAiVideoMode(ctx, draft) {
    await userState.updateUser(ctx.from.id, (current) => ({
      ...current,
      aiVideoDraft: draft,
      pendingAction: {
        type: 'ai_video_choose_prompt_mode',
        payload: {
          referenceImagePath: draft.referenceImagePath,
          sourcePath: draft.sourcePath,
          sourceOriginalName: draft.sourceOriginalName || 'ai-video-reference.png'
        }
      }
    }));

    await ctx.reply(
      'Как подготовить AI video sticker?',
      buildAiVideoPromptModeKeyboard(ctx.from.id)
    );
  }

  async function enqueueAiVideoJob(ctx, payload, { promptMode, prompt = '', existingStatusMessageId = null }) {
    const currentUser = await userState.getUser(ctx.from.id);
    if (currentUser.aiVideoChargePending?.jobId) {
      throw new AppError('AI video generation is already running. Wait for the current one to finish.');
    }

    const availableBalance = getAvailableAiVideoTokens(currentUser);
    if (availableBalance < config.aiVideoTokenCost) {
      throw new AppError('Not enough AI video tokens.');
    }

    const statusMessageId = existingStatusMessageId || (await createStatusMessage(ctx)).message_id;
    const job = await backend.createJobFromUpload({
      inputPath: payload.referenceImagePath,
      originalName: payload.sourceOriginalName || 'ai-video-reference.png',
      source: 'bot',
      owner: {
        chatId: ctx.chat.id,
        userId: ctx.from.id
      },
      options: {
        jobType: 'generate_video',
        inputType: 'video',
        outputExtension: '.mp4',
        promptMode,
        prompt
      }
    });

    await setAiVideoChargePending(ctx.from.id, {
      jobId: job.id,
      amount: config.aiVideoTokenCost,
      createdAt: new Date().toISOString()
    });
    await rememberStatusMessage(ctx.chat.id, job.id, statusMessageId);
    await updateStatusMessage(job);
    return availableBalance - config.aiVideoTokenCost;
  }

  async function setSelectedLanguage(userId, selectedLanguage) {
    await userState.updateUser(userId, (current) => ({
      ...current,
      profile: {
        ...(current.profile || {}),
        selectedLanguage,
        updatedAt: new Date().toISOString()
      }
    }));
  }

  async function promptForLanguageSelection(ctx) {
    await ctx.reply(buildLanguagePrompt(), buildLanguageKeyboard(ctx.from.id));
  }

  async function sendStarsInvoice(ctx, tokenAmount) {
    const tokenWord = tokenAmount === 1 ? 'Token' : 'Tokens';
    const title = `${tokenAmount} AI Video ${tokenWord}`;
    const description = `Adds ${tokenAmount} ${tokenWord.toLowerCase()} for AI video sticker generation.`;
    const payload = `ai_video_tokens:${tokenAmount}:${createId('stars_')}`;

    await ctx.telegram.callApi('sendInvoice', {
      chat_id: ctx.chat.id,
      title,
      description,
      payload,
      provider_token: '',
      currency: 'XTR',
      prices: [
        {
          label: `${tokenAmount} ${tokenWord}`,
          amount: tokenAmount
        }
      ],
      start_parameter: `ai-video-${tokenAmount}`
    });
  }

  bot.start(async (ctx) => {
    await syncUserProfile(ctx);
    await ctx.reply(helpText(config.baseUrl));
  });
  bot.help(async (ctx) => {
    await syncUserProfile(ctx);
    await ctx.reply(helpText(config.baseUrl));
  });

  bot.command('language', async (ctx) => {
    await syncUserProfile(ctx);
    await promptForLanguageSelection(ctx);
  });

  bot.command('pay', async (ctx) => {
    await syncUserProfile(ctx);
    const user = await userState.getUser(ctx.from.id);
    const balance = Number(user.balances?.aiVideoTokens || 0);
    await ctx.reply(buildBuyTokensText(balance), buildStarsPaymentKeyboard(ctx.from.id));
  });

  bot.on('pre_checkout_query', async (ctx) => {
    await ctx.telegram.callApi('answerPreCheckoutQuery', {
      pre_checkout_query_id: ctx.update.pre_checkout_query.id,
      ok: true
    });
  });

  bot.on('message', async (ctx, next) => {
    const payment = ctx.message?.successful_payment;
    if (!payment) {
      return next();
    }

    await syncUserProfile(ctx);

    const match = /^ai_video_tokens:(\d+):/.exec(payment.invoice_payload || '');
    if (!match) {
      await ctx.reply('Payment received, but the token package was not recognized.');
      return;
    }

    const tokenAmount = Number(match[1]);
    const balance = await grantAiVideoTokens(ctx.from.id, tokenAmount);
    await ctx.reply(
      `Payment received. Added ${tokenAmount} ${formatTokenWord(tokenAmount)}. Your balance is now ${balance} ${formatTokenWord(balance)}.`
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

    const lines = user.stickerSets.map((set, index) => `${index + 1}. ${getStickerSetDisplayTitle(set)} - https://t.me/addstickers/${set.name}`);
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
        Markup.button.callback(`📦 ${getStickerSetDisplayTitle(set)}`, `pickset:${ctx.from.id}:${index}`)
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

    if (action === 'setlang') {
      if (ctx.from.id !== ownerId) {
        await ctx.answerCbQuery('This button is not for you.');
        return;
      }

      const selectedLanguage = third === 'ru' ? 'ru' : 'en';
      await setSelectedLanguage(ctx.from.id, selectedLanguage);
      await deleteMessageQuietly(ctx.chat.id, ctx.callbackQuery.message?.message_id);
      await ctx.answerCbQuery(selectedLanguage === 'ru' ? 'Язык сохранён.' : 'Language saved.');
      await ctx.reply(helpText(config.baseUrl));
      return;
    }

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

    if (action === 'buytokens') {
      const tokenAmount = Number(third);

      if (!STAR_TOKEN_PACKAGES.includes(tokenAmount)) {
        await ctx.answerCbQuery('Unknown package.');
        return;
      }

      await ctx.answerCbQuery();
      await sendStarsInvoice(ctx, tokenAmount);
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
            Markup.button.callback(`📦 ${getStickerSetDisplayTitle(set)}`, `pickset:${ctx.from.id}:${index}`)
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
      await deleteMessageQuietly(ctx.chat.id, ctx.callbackQuery.message?.message_id);
      await promptForNewPackTitle(ctx);
      await ctx.answerCbQuery();
      return;
    }

    if (action === 'aivideo') {
      const user = await userState.getUser(ctx.from.id);
      const pending = user.pendingAction;
      const balance = getAvailableAiVideoTokens(user);

      if (pending?.type !== 'choose_layout' || !pending.payload) {
        await ctx.answerCbQuery('Parameters not found.');
        return;
      }

      if ((pending.payload.inputType || 'image') !== 'image') {
        await ctx.answerCbQuery('AI video sticker works only for images.');
        return;
      }

      if (user.aiVideoChargePending?.jobId) {
        await ctx.answerCbQuery('AI video is already running.');
        return;
      }

      if (balance < config.aiVideoTokenCost) {
        await ctx.answerCbQuery('Not enough tokens.');
        await ctx.reply(
          buildBuyTokensText(balance),
          buildStarsPaymentKeyboard(ctx.from.id)
        );
        return;
      }

      const draft = await prepareAiVideoReferenceDraft(ctx.from.id, pending.payload.inputPath, {
        sourceOriginalName: pending.payload.originalName
      });
      await ctx.answerCbQuery('Открываю настройки AI video.');
      await promptForAiVideoMode(ctx, draft);
      return;
    }

    if (action === 'aivideofromlast') {
      const user = await userState.getUser(ctx.from.id);
      const balance = getAvailableAiVideoTokens(user);

      if (!user.lastConverted?.path) {
        await ctx.answerCbQuery('No sticker available.');
        return;
      }

      if (user.aiVideoChargePending?.jobId) {
        await ctx.answerCbQuery('AI video is already running.');
        return;
      }

      if (balance < config.aiVideoTokenCost) {
        await ctx.answerCbQuery('Not enough tokens.');
        await ctx.reply(
          buildBuyTokensText(balance),
          buildStarsPaymentKeyboard(ctx.from.id)
        );
        return;
      }

      const draft = await prepareAiVideoReferenceFromLast(ctx.from.id);
      await deleteMessageQuietly(ctx.chat.id, ctx.callbackQuery.message?.message_id);
      await ctx.answerCbQuery('Открываю настройки AI video.');
      await promptForAiVideoMode(ctx, draft);
      return;
    }

    if (action === 'aivideomode') {
      const user = await userState.getUser(ctx.from.id);
      const pending = user.pendingAction;

      if (pending?.type !== 'ai_video_choose_prompt_mode' || !pending.payload?.referenceImagePath) {
        await ctx.answerCbQuery('Реф для AI video не найден.');
        return;
      }

      await deleteMessageQuietly(ctx.chat.id, ctx.callbackQuery.message?.message_id);

      if (third === 'custom') {
        await userState.updateUser(ctx.from.id, (current) => ({
          ...current,
          pendingAction: {
            type: 'ai_video_wait_custom_prompt',
            payload: pending.payload
          }
        }));
        await ctx.answerCbQuery('Жду ваш prompt.');
        await ctx.reply(
          'Пришлите prompt для AI video. Я расширю его, переведу на английский под Seedance и запущу генерацию.',
          buildAiVideoPromptInputKeyboard(ctx.from.id)
        );
        return;
      }

      await userState.updateUser(ctx.from.id, (current) => ({
        ...current,
        pendingAction: null
      }));
      await ctx.answerCbQuery('Придумываю движение.');
      await enqueueAiVideoJob(ctx, pending.payload, {
        promptMode: 'random'
      });
      return;
    }

    if (action === 'aivideorandomfromprompt') {
      const user = await userState.getUser(ctx.from.id);
      const pending = user.pendingAction;

      if (pending?.type !== 'ai_video_wait_custom_prompt' || !pending.payload?.referenceImagePath) {
        await ctx.answerCbQuery('Реф для AI video не найден.');
        return;
      }

      await userState.updateUser(ctx.from.id, (current) => ({
        ...current,
        pendingAction: null
      }));

      await deleteMessageQuietly(ctx.chat.id, ctx.callbackQuery.message?.message_id);
      await ctx.answerCbQuery('Переключаю на случайный prompt.');
      await enqueueAiVideoJob(ctx, pending.payload, {
        promptMode: 'random'
      });
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
        Markup.button.callback(`📦 ${getStickerSetDisplayTitle(set)}`, `pickset:${ctx.from.id}:${index}`)
      ]);
      try {
        await ctx.editMessageReplyMarkup(undefined);
      } catch {
        // Keep the sticker message even if Telegram refuses to edit old markup.
      }
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

      if (user.pendingAction?.type === 'ai_video_wait_custom_prompt') {
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

        await enqueueAiVideoJob(ctx, payload, {
          promptMode: 'custom',
          prompt
        });
        return;
      }

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

    if (internalJob.jobType === 'generate_video') {
      await confirmAiVideoCharge(internalJob.owner.userId, internalJob.id);
    }

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

    if (internalJob.jobType === 'generate_video') {
      await userState.updateUser(internalJob.owner.userId, (current) => ({
        ...current,
        pendingAction: {
          type: 'choose_layout',
          payload: {
            inputPath: internalJob.generatedSourcePath || internalJob.outputPath,
            originalName: internalJob.originalName || 'generated-video.mp4',
            inputType: 'video'
          }
        }
      }));

      try {
        await bot.telegram.sendVideo(
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
        buildLayoutPrompt('video'),
        buildLayoutKeyboard({
          userId: internalJob.owner.userId,
          inputType: 'video',
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

    if (internalJob.jobType === 'generate_video') {
      try {
        await clearAiVideoChargePending(internalJob.owner.userId, internalJob.id);
      } catch (error) {
        console.error('Failed to clear pending AI video charge', error);
      }
    }

    const failurePrefix = internalJob.jobType === 'generate_video'
      ? 'AI video не удалось создать'
      : 'Конвертация не удалась';

    await bot.telegram.sendMessage(
      internalJob.owner.chatId,
      `${failurePrefix}: ${job.error}`
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
      let adminThumbnail = null;
      try {
        adminThumbnail = await createAdminThumbnailFromSticker(user.lastConverted.path);
      } catch {
        adminThumbnail = null;
      }

      const created = await stickerSets.createNewSet({
        userId: ctx.from.id,
        title: buildPackTitle(payload.title, me.username),
        shortName: payload.shortName,
        emoji: payload.emoji || DEFAULT_EMOJI,
        stickerPath: user.lastConverted.path,
        stickerFormat: user.lastConverted.stickerFormat || 'video'
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
                addedAt: new Date().toISOString(),
                thumbnailUrl: adminThumbnail?.publicUrl || null
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
      let adminThumbnail = null;
      try {
        adminThumbnail = await createAdminThumbnailFromSticker(user.lastConverted.path);
      } catch {
        adminThumbnail = null;
      }

      const added = await stickerSets.addToSet({
        userId: ctx.from.id,
        setName,
        emoji: emoji || DEFAULT_EMOJI,
        stickerPath: user.lastConverted.path,
        stickerFormat: user.lastConverted.stickerFormat || 'video'
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
                addedAt: new Date().toISOString(),
                thumbnailUrl: adminThumbnail?.publicUrl || null
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
    launch: async () => {
      bot.launch().catch((error) => {
        console.error('Telegram bot launch error', error);
      });
    },
    stop: async (reason) => bot.stop(reason)
  };
}







