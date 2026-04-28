import { config } from '../config/env.js';

const CUSTOM_PROMPT_SYSTEM = `You adapt user requests into short English Seedance-ready directions for reference-based image-to-video generation.

Rules:
- Output only one short English direction for the requested effect or motion.
- Preserve the main subject and its recognizable identity, but small pose/expression changes are allowed.
- You may add a slightly more imaginative, playful, or surprising action if it still feels connected to the reference.
- Small temporary effects, motion accents, props already implied by the image, or expressive reactions are allowed.
- The background should remain generally consistent, but you do not need to describe it.
- Avoid replacing the subject, changing the scene completely, adding unrelated characters, explicit sexual content, graphic violence, or hostile gestures.
- Output one vivid English Seedance direction for a 3-second sticker clip, with a clear action beat.
- If the user explicitly asks for a visual transformation or magical effect, keep that transformation in the output in a short, practical way. Do not replace it with generic motion.
- Explicit requests like sparkles, magical aura, fairy transformation, wings, outfit change, glowing effects, or beauty transformation should stay in the final direction if they are safe.
- If the user asks for something risky or hostile, rewrite it into the closest safe, non-hostile, non-graphic version while keeping the basic creative idea.
- Good outputs are like: "Add soft blinking and gentle breathing." / "Add sparkling magic particles around her and transform her into a fairy-like magical version."
- Do not wrap your answer in quotes.`;

const RANDOM_PROMPT_SYSTEM = `You are looking at a reference image for a 3-second Seedance sticker video.

Your job:
- First understand what the main visible subject is.
- Then decide what, in your judgment, should naturally happen next in a short sticker-like clip for that exact subject.
- Base the motion on what is actually visible in the image. Do not ignore the reference.
- Preserve the main subject and its recognizable identity, but small pose/expression changes are allowed.
- You may add a slightly more imaginative, playful, or surprising action if it still feels connected to the reference.
- Small temporary effects, motion accents, props already implied by the image, or expressive reactions are allowed.
- The background should remain generally consistent, but you do not need to describe it.
- Avoid replacing the subject, changing the scene completely, adding unrelated characters, explicit sexual content, graphic violence, or hostile gestures.
- Output one vivid English Seedance direction for a 3-second sticker clip, with a clear action beat.
- Good outputs are like: "Make the subject perform the most natural tiny action suggested by the image, with a clear beginning and end over 3 seconds." / "Animate the visible subject with a small playful action that feels implied by the pose, while preserving the exact reference content."`;

const DEFAULT_CUSTOM_DIRECTION = 'Add one subtle, believable motion with minimal movement.';
const DEFAULT_RANDOM_MOTION = 'Add a subtle blink and a slight natural movement.';
const DEFAULT_CHROMA_KEY_SETTINGS = {
  backgroundHex: '00FF00',
  similarity: 0.35,
  blur: '6:3'
};
const CHROMA_KEY_SYSTEM = `You choose a temporary chroma-key background for a transparent sticker reference before image-to-video generation.

Goal:
- Pick a solid fill color that is least likely to overlap with the visible subject colors.
- Pick an ffmpeg chromakey similarity value.
- Pick an ffmpeg boxblur value for safety fallback/reference blur, formatted as radius:power.

Rules:
- Avoid any color that appears in the subject, semi-transparent antialiasing edges, clothes, props, hair, skin, eyes, shadows, highlights, or important details.
- Choose any pure, saturated, solid RGB hex color that is clearly absent from the entire visible subject and its edges.
- The best color is not just different from the main object; it must also avoid edge/outline colors so chromakey will not eat the subject.
- Prefer very artificial chroma-like colors over natural colors.
- Choose similarity yourself based on the subject and background color, but it must be at least 0.30.
- Choose blur yourself; use lower blur for safe/clean images and stronger blur only when needed.
- Output only compact JSON, no markdown, no explanation.

Example:
{"backgroundHex":"00FF00","similarity":0.35,"blur":"6:3"}`;
const AI_VIDEO_PLAN_SYSTEM = `You prepare one compact plan for a transparent reference-based Seedance sticker video.

Return only compact JSON with exactly these fields:
{"motionPrompt":"...","backgroundHex":"...","similarity":0.33,"blur":"6:3"}

motionPrompt rules:
- Write one vivid English Seedance direction for a 3-second sticker clip.
- Preserve the main visible subject and recognizable identity.
- Small pose/expression changes, temporary effects, motion accents, or playful actions are allowed if connected to the reference.
- Avoid replacing the subject, changing the scene completely, unrelated characters, explicit sexual content, graphic violence, or hostile gestures.
- If the user gave a custom prompt, adapt it to English while preserving the requested safe transformation/effect.
- If the user chose random, decide what should naturally happen next based on the image.

chroma rules:
- Choose a solid backgroundHex that is clearly absent from the visible subject, semi-transparent antialiasing edges, clothes, props, hair, skin, eyes, shadows, highlights, and important details.
- Choose any pure, saturated, solid RGB hex color that is far from the entire visible subject and its outline/edges.
- The best background color is the one least likely to be removed from the subject by chromakey.
- Prefer very artificial chroma-like colors over natural colors.
- Choose ffmpeg chromakey similarity yourself based on the subject and chosen color, but it must be at least 0.30.
- Choose ffmpeg boxblur value yourself for moderation fallback/reference blur, formatted radius:power, for example "0:0", "4:2", "6:3", "8:3", or "10:3".
- Use lower blur for safe/clean images and stronger blur only if the image may need softened details.

Do not return markdown or explanations.`;
const RANDOM_PROMPT_SAMPLING_PROFILES = [
  { temperature: 0.85, topP: 0.9 },
  { temperature: 1.15, topP: 1.0 },
  { temperature: 2.0, topP: 1.0 }
];

function normalizeDirectionLine(value, fallback) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^["'\-\s]+|["'\-\s]+$/g, '')
    .trim();

  if (!text) {
    return fallback;
  }

  const sanitized = text
    .replace(/\b(young|adult|woman|man|girl|boy|person with|long hair|short hair|white t-shirt|black hair)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!sanitized) {
    return fallback;
  }

  return /[.!?]$/.test(sanitized) ? sanitized : `${sanitized}.`;
}

function looksLikeExplicitTransformationRequest(value) {
  const text = String(value || '').toLowerCase();
  return /(преврат|фея|винкс|магичес|крыл|блест|мерца|spark|glitter|fairy|transform|magic|wing|aura|glow|outfit|dress)/i.test(text);
}

function deriveCustomFallbackDirection(originalPrompt) {
  const text = String(originalPrompt || '').toLowerCase();
  const effects = [];

  if (/(блест|мерца|spark|glitter|shimmer|twinkl)/i.test(text)) {
    effects.push('Add shimmering sparkling particles around the subject');
  }

  if (/(фея|винкс|fairy|winx|magic|магичес)/i.test(text)) {
    effects.push('transform the subject into a fairy-like magical version with elegant glowing wings and a soft magical aura');
  }

  if (/(улыб|smile)/i.test(text)) {
    effects.push('add a faint smile');
  }

  if (/(морг|blink)/i.test(text)) {
    effects.push('add a soft blink');
  }

  if (!effects.length) {
    return DEFAULT_CUSTOM_DIRECTION;
  }

  return `${effects.join(', ')}, with minimal stable motion`;
}

function uniqueProviders() {
  const seen = new Set();
  const ordered = [];

  for (const provider of config.chatProviders) {
    if (!provider?.apiKey || !provider?.model) {
      continue;
    }

    const key = `${provider.baseUrl}|${provider.model}|${provider.apiKey}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    ordered.push(provider);
  }

  return ordered;
}

function pickRandomSamplingProfile() {
  return RANDOM_PROMPT_SAMPLING_PROFILES[
    Math.floor(Math.random() * RANDOM_PROMPT_SAMPLING_PROFILES.length)
  ];
}

function pickRandomSamplingProfileByLevel(level) {
  const index = Math.max(1, Math.min(3, Number(level) || 0)) - 1;
  return RANDOM_PROMPT_SAMPLING_PROFILES[index] || pickRandomSamplingProfile();
}

function extractJsonObject(value) {
  const text = String(value || '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function normalizeChromaKeySettings(value) {
  const rawHex = String(value?.backgroundHex || value?.color || '')
    .replace(/^#/, '')
    .trim()
    .toUpperCase();
  const backgroundHex = /^[0-9A-F]{6}$/.test(rawHex)
    ? rawHex
    : DEFAULT_CHROMA_KEY_SETTINGS.backgroundHex;
  const similarity = Number(value?.similarity);
  const blur = String(value?.blur || '')
    .trim()
    .match(/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/)?.[0] || DEFAULT_CHROMA_KEY_SETTINGS.blur;

  return {
    backgroundHex,
    similarity: Number.isFinite(similarity) && similarity > 0
      ? Number(Math.max(0.30, similarity).toFixed(3))
      : DEFAULT_CHROMA_KEY_SETTINGS.similarity,
    blur
  };
}

function normalizeAiVideoPlan(value, { promptMode = 'custom', prompt = '' } = {}) {
  const chromaKey = normalizeChromaKeySettings(value);
  const fallbackMotion = promptMode === 'random'
    ? DEFAULT_RANDOM_MOTION
    : (
        looksLikeExplicitTransformationRequest(prompt)
          ? deriveCustomFallbackDirection(prompt)
          : normalizeDirectionLine(prompt, DEFAULT_CUSTOM_DIRECTION)
      );

  return {
    motionPrompt: normalizeDirectionLine(value?.motionPrompt || value?.prompt || value?.direction, fallbackMotion),
    chromaKey
  };
}

export class AiVideoPromptService {
  constructor({ providers = uniqueProviders(), timeoutMs = config.chatRequestTimeoutMs } = {}) {
    this.providers = providers;
    this.timeoutMs = timeoutMs;
  }

  async requestWithProviders(messages, options = 0.25) {
    const sampling = typeof options === 'number'
      ? { temperature: options }
      : {
          temperature: options?.temperature ?? 0.25,
          topP: options?.topP
        };
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
            temperature: sampling.temperature,
            ...(sampling.topP ? { top_p: sampling.topP } : {}),
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
      const direction = await this.requestWithProviders([
        { role: 'system', content: CUSTOM_PROMPT_SYSTEM },
        {
          role: 'user',
          content: `Turn this user request into one short English Seedance direction for a reference-based 3-second sticker clip:\n\n${trimmedPrompt}`
        }
      ], 0.25);
      return normalizeDirectionLine(direction, DEFAULT_CUSTOM_DIRECTION);
    } catch {
      return normalizeDirectionLine(
        looksLikeExplicitTransformationRequest(trimmedPrompt)
          ? deriveCustomFallbackDirection(trimmedPrompt)
          : trimmedPrompt,
        DEFAULT_CUSTOM_DIRECTION
      );
    }
  }

  async createRandomPromptFromImage(referenceImageUrl, { level = null } = {}) {
    if (!referenceImageUrl) {
      return DEFAULT_RANDOM_MOTION;
    }

    try {
      const sampling = level ? pickRandomSamplingProfileByLevel(level) : pickRandomSamplingProfile();
      const motion = await this.requestWithProviders([
        { role: 'system', content: RANDOM_PROMPT_SYSTEM },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Look at this reference image and write one concise English Seedance direction for what should naturally happen next in a 3-second sticker video. Preserve the exact reference content.'
            },
            {
              type: 'image_url',
              image_url: {
                url: referenceImageUrl
              }
            }
          ]
        }
      ], sampling);
      return normalizeDirectionLine(motion, DEFAULT_RANDOM_MOTION);
    } catch {
      return DEFAULT_RANDOM_MOTION;
    }
  }

  async chooseChromaKeySettings(referenceImageUrl) {
    if (!referenceImageUrl) {
      return { ...DEFAULT_CHROMA_KEY_SETTINGS };
    }

    try {
      const response = await this.requestWithProviders([
        { role: 'system', content: CHROMA_KEY_SYSTEM },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Look at the visible subject only. Choose the best solid chroma-key background color and ffmpeg chromakey similarity value.'
            },
            {
              type: 'image_url',
              image_url: {
                url: referenceImageUrl
              }
            }
          ]
        }
      ], {
        temperature: 0.1,
        topP: 0.5
      });

      return normalizeChromaKeySettings(extractJsonObject(response));
    } catch {
      return { ...DEFAULT_CHROMA_KEY_SETTINGS };
    }
  }

  async createAiVideoPlanFromImage(referenceImageUrl, { promptMode = 'custom', prompt = '', level = null } = {}) {
    if (!referenceImageUrl) {
      return normalizeAiVideoPlan(null, { promptMode, prompt });
    }

    try {
      const trimmedPrompt = String(prompt || '').trim();
      const sampling = promptMode === 'random'
        ? (level ? pickRandomSamplingProfileByLevel(level) : pickRandomSamplingProfile())
        : { temperature: 0.25, topP: 0.9 };
      const requestText = promptMode === 'random'
        ? `Mode: random. Randomness level: ${level || 'auto'}. Look at the image and choose the motion prompt plus chroma settings.`
        : `Mode: custom. User prompt: ${trimmedPrompt || DEFAULT_CUSTOM_DIRECTION}\nAdapt the prompt and choose chroma settings from the image.`;

      const response = await this.requestWithProviders([
        { role: 'system', content: AI_VIDEO_PLAN_SYSTEM },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: requestText
            },
            {
              type: 'image_url',
              image_url: {
                url: referenceImageUrl
              }
            }
          ]
        }
      ], sampling);

      return normalizeAiVideoPlan(extractJsonObject(response), { promptMode, prompt: trimmedPrompt });
    } catch {
      return normalizeAiVideoPlan(null, { promptMode, prompt });
    }
  }
}
