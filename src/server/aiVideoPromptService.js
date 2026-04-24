import { config } from '../config/env.js';

const CUSTOM_PROMPT_SYSTEM = `You adapt user requests into short, practical English prompts for ByteDance Seedance image-to-video generation.

Rules:
- Output only the final English prompt.
- Preserve the reference image's subject, identity, pose, camera angle, lighting, and overall composition unless the user explicitly asks to change them.
- Optimize for a 3-second square sticker-like video.
- Prefer one small, believable motion instead of many actions.
- Keep the scene stable, subtle, and easy for image-to-video generation.
- Avoid extra characters, scene changes, text overlays, surreal transformations, violence, hostile gestures, and explicit sexual content.
- If the user asks for something risky or hostile, rewrite it into the closest safe, non-hostile, non-graphic version while keeping the basic creative idea.
- Make the prompt ready to send directly to Seedance.`;

const RANDOM_PROMPT_SYSTEM = `You are looking at a reference image for a 3-second Seedance sticker video.

Your job:
- Describe what is visible in the image briefly in your head, then output only one final English prompt for image-to-video generation.
- Preserve the subject, identity, pose, camera angle, lighting, and composition from the reference image.
- Invent one small, interesting, believable motion for a short 3-second square video sticker.
- Prefer subtle motion such as blinking, breathing, a small head tilt, a hand adjustment, a tiny smile, a soft glance, or another minimal action that fits the image.
- Keep the background unchanged.
- Avoid scene changes, extra objects, hostile gestures, violence, surreal body changes, text, and explicit sexual content.
- Output only the final English prompt.`;

function uniqueProviders(preferredFirst = true) {
  const seen = new Set();
  const preferred = [];
  const others = [];

  for (const provider of config.chatProviders) {
    if (!provider?.apiKey || !provider?.model) {
      continue;
    }

    const key = `${provider.baseUrl}|${provider.model}|${provider.apiKey}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    if (/deepseek/i.test(provider.model)) {
      preferred.push(provider);
    } else {
      others.push(provider);
    }
  }

  return preferredFirst ? [...preferred, ...others] : [...others, ...preferred];
}

export class AiVideoPromptService {
  constructor({ providers = uniqueProviders(true), timeoutMs = config.chatRequestTimeoutMs } = {}) {
    this.providers = providers;
    this.timeoutMs = timeoutMs;
  }

  async requestWithProviders(messages) {
    let lastError = null;

    for (const provider of this.providers) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(`${provider.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: provider.model,
            temperature: 0.6,
            messages
          }),
          signal: controller.signal
        });
        clearTimeout(timer);

        const rawBody = await response.text();
        let payload = null;

        try {
          payload = rawBody ? JSON.parse(rawBody) : null;
        } catch {
          payload = null;
        }

        if (!response.ok) {
          lastError = new Error(
            payload?.error?.message ||
            payload?.message ||
            rawBody ||
            `Chat request failed with ${response.status}`
          );
          continue;
        }

        const content = payload?.choices?.[0]?.message?.content?.trim();
        if (content) {
          return content;
        }

        lastError = new Error('Prompt service returned an empty response.');
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
      }
    }

    throw lastError || new Error('No chat providers available for AI video prompt generation.');
  }

  async enhanceCustomPrompt(prompt) {
    const trimmedPrompt = String(prompt || '').trim();
    if (!trimmedPrompt) {
      return '';
    }

    try {
      return await this.requestWithProviders([
        { role: 'system', content: CUSTOM_PROMPT_SYSTEM },
        {
          role: 'user',
          content: `Turn this into a short English Seedance-ready image-to-video prompt for a 3-second square sticker clip:\n\n${trimmedPrompt}`
        }
      ]);
    } catch {
      return trimmedPrompt;
    }
  }

  async createRandomPromptFromImage(referenceImageUrl) {
    if (!referenceImageUrl) {
      return 'Using the reference image, preserve the same scene and composition. Add one subtle, believable motion for a short 3-second square sticker video, with minimal movement and no scene change.';
    }

    try {
      return await this.requestWithProviders([
        { role: 'system', content: RANDOM_PROMPT_SYSTEM },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Look at this reference image and write one Seedance-ready English prompt for a subtle 3-second square sticker video.'
            },
            {
              type: 'image_url',
              image_url: {
                url: referenceImageUrl
              }
            }
          ]
        }
      ]);
    } catch {
      return 'Using the reference image, preserve the same subject, pose, camera angle, and lighting. Add one small, interesting, natural motion for a 3-second square sticker video, with minimal movement and no scene change.';
    }
  }
}
