import { config } from '../config/env.js';
import { AppError } from '../utils/errors.js';

const HISTORY_LIMIT = 12;
const MAX_RETRIES = 2;
const CHAT_OPEN = '[CHAT_REPLY]';
const CHAT_CLOSE = '[/CHAT_REPLY]';
const GENERATE_OPEN = '[GENERATE_IMAGE]';
const GENERATE_CLOSE = '[/GENERATE_IMAGE]';
const FALLBACK_HISTORY_LIMIT = 4;

function normalizeHistory(history = []) {
  return history
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .slice(-HISTORY_LIMIT);
}

function parseAssistantResponse(answer) {
  const trimmed = String(answer || '').trim();
  const chatStartIndex = trimmed.indexOf(CHAT_OPEN);
  if (chatStartIndex !== -1) {
    const chatEndIndex = trimmed.indexOf(CHAT_CLOSE, chatStartIndex + CHAT_OPEN.length);
    const chatAnswer = trimmed
      .slice(
        chatStartIndex + CHAT_OPEN.length,
        chatEndIndex !== -1 ? chatEndIndex : trimmed.length
      )
      .trim();
    if (chatAnswer) {
      return {
        mode: 'chat',
        answer: chatAnswer
      };
    }
  }

  const startIndex = trimmed.indexOf(GENERATE_OPEN);
  if (startIndex === -1) {
    return {
      mode: 'chat',
      answer: trimmed
    };
  }

  const endIndex = trimmed.indexOf(GENERATE_CLOSE, startIndex + GENERATE_OPEN.length);
  const prompt = trimmed
    .slice(
      startIndex + GENERATE_OPEN.length,
      endIndex !== -1 ? endIndex : trimmed.length
    )
    .trim();
  if (!prompt) {
    return {
      mode: 'chat',
      answer: trimmed
    };
  }

  return {
    mode: 'generate_image',
    prompt
  };
}

function isUploadHistoryFailure(status, details) {
  return (
    status >= 400 &&
    /upload history file: upload file failed|upload file failed/i.test(String(details || ''))
  );
}

function isProviderFallbackError(status, details) {
  const text = String(details || '');
  return (
    status >= 500 ||
    status === 429 ||
    /model_not_found|no available channel|upstream_empty_output|temporarily unavailable|service unavailable/i.test(text)
  );
}

export class ChatCompletionService {
  constructor({ chatPromptService }) {
    this.chatPromptService = chatPromptService;
  }

  async requestCompletionWithProvider(provider, messages) {
    let payload = null;
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.chatRequestTimeoutMs);
      let response;

      try {
        response = await fetch(`${provider.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: provider.model,
            messages,
            temperature: 0.8
          }),
          signal: controller.signal
        });
      } catch (error) {
        clearTimeout(timer);
        if (error?.name === 'AbortError') {
          throw new AppError('Chat provider timed out.', 504);
        }
        throw new AppError(`Chat provider request failed: ${error.message}`, 502);
      }
      clearTimeout(timer);

      if (response.ok) {
        payload = await response.json();
        return { payload, uploadHistoryFailure: false };
      }

      const details = await response.text();
      const shouldRetry =
        attempt < MAX_RETRIES &&
        response.status === 429 &&
        /upstream_empty_output/i.test(details);

      if (shouldRetry) {
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
        continue;
      }

      lastError = {
        status: response.status,
        details
      };

      if (isUploadHistoryFailure(response.status, details)) {
        return { payload: null, uploadHistoryFailure: true };
      }

      break;
    }

    throw new AppError(
      `Chat provider error: ${lastError?.details || 'Unknown error'}`,
      lastError?.status || 502
    );
  }

  async requestCompletion(messages) {
    let lastError = null;

    for (const provider of config.chatProviders) {
      try {
        const result = await this.requestCompletionWithProvider(provider, messages);
        if (result?.payload) {
          const answer = result.payload?.choices?.[0]?.message?.content?.trim();
          if (answer) {
            return result;
          }

          lastError = new AppError(
            `Chat provider error: empty response from ${provider.model}`,
            502
          );
          continue;
        }

        if (result?.uploadHistoryFailure) {
          return result;
        }
      } catch (error) {
        lastError = error;
        if (
          error instanceof AppError &&
          (error.statusCode === 504 || isProviderFallbackError(error.statusCode, error.message))
        ) {
          continue;
        }
        throw error;
      }
    }

    throw lastError || new AppError('Chat provider error: no available providers.', 502);
  }

  async reply({ message, history = [] }) {
    const trimmedMessage = String(message || '').trim();
    if (!trimmedMessage) {
      throw new AppError('Empty chat message.');
    }

    if (!config.chatProviders.length) {
      throw new AppError('CHAT provider is not configured: OPENAI_API_KEY is missing.', 500);
    }

    const systemPrompt = await this.chatPromptService.getPrompt();
    const normalizedHistory = normalizeHistory(history);
    const historyVariants = [
      normalizedHistory,
      normalizedHistory.slice(-FALLBACK_HISTORY_LIMIT),
      []
    ];

    let payload = null;
    let effectiveHistory = normalizedHistory;

    for (const candidateHistory of historyVariants) {
      const messages = [
        { role: 'system', content: systemPrompt },
        ...candidateHistory,
        { role: 'user', content: trimmedMessage }
      ];
      const result = await this.requestCompletion(messages);
      if (result.payload) {
        payload = result.payload;
        effectiveHistory = candidateHistory;
        break;
      }

      if (!result.uploadHistoryFailure) {
        break;
      }
    }

    if (!payload) {
      throw new AppError('Chat provider временно не смог обработать историю диалога. Попробуйте ещё раз.', 502);
    }

    const answer = payload?.choices?.[0]?.message?.content?.trim();

    if (!answer) {
      throw new AppError('Chat provider returned an empty response.', 502);
    }

    const parsed = parseAssistantResponse(answer);
    if (parsed.mode === 'generate_image') {
      return {
        ...parsed,
        nextHistory: effectiveHistory
      };
    }

    return {
      ...parsed,
      nextHistory: [
        ...effectiveHistory,
        { role: 'user', content: trimmedMessage },
        { role: 'assistant', content: parsed.answer }
      ].slice(-HISTORY_LIMIT)
    };
  }
}
