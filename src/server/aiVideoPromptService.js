import { config } from '../config/env.js';

const CUSTOM_PROMPT_SYSTEM = `You adapt user requests into short English Seedance-ready directions for reference-based image-to-video generation.

Rules:
- Output only one short English direction for the requested effect or motion.
- Preserve the main subject and its recognizable identity, but small pose/expression changes are allowed.
- Do not introduce a woman, man, person, character, animal, face, or body if it is not clearly visible in the reference.
- Do not turn an object, icon, logo, sticker, prop, or abstract subject into a human character.
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
- Do not introduce a woman, man, person, character, animal, face, or body if it is not clearly visible in the reference.
- Do not turn an object, icon, logo, sticker, prop, or abstract subject into a human character.
- If the subject is ambiguous, animate the visible shapes/details only instead of inventing gender, age, or identity.
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
  similarity: 0.30,
  blur: '0:0'
};
const CHROMA_KEY_SYSTEM = `You choose a temporary chroma-key background for a transparent sticker reference before image-to-video generation.

Goal:
- Pick a solid fill color that is least likely to overlap with the visible subject colors.

Rules:
- Avoid any color that appears in the subject, semi-transparent antialiasing edges, clothes, props, hair, skin, eyes, shadows, highlights, or important details.
- Choose any pure, saturated, solid RGB hex color that is clearly absent from the entire visible subject and its edges.
- The best color is not just different from the main object; it must also avoid edge/outline colors so chromakey will not eat the subject.
- Prefer very artificial chroma-like colors over natural colors.
- Output only compact JSON, no markdown, no explanation.

Example:
{"backgroundHex":"00FF00"}`;
const AI_VIDEO_PLAN_SYSTEM = `You prepare one compact plan for a transparent reference-based Seedance sticker video.

Return only compact JSON with exactly these fields:
{"motionPrompt":"...","backgroundHex":"..."}

motionPrompt rules:
- Write one vivid English Seedance direction for a 3-second sticker clip.
- Preserve the main visible subject and recognizable identity.
- Do not introduce a woman, man, person, character, animal, face, or body if it is not clearly visible in the reference.
- Do not turn an object, icon, logo, sticker, prop, or abstract subject into a human character.
- If the subject is ambiguous, animate the visible shapes/details only instead of inventing gender, age, or identity.
- Small pose/expression changes, temporary effects, motion accents, or playful actions are allowed if connected to the reference.
- Avoid replacing the subject, changing the scene completely, unrelated characters, explicit sexual content, graphic violence, or hostile gestures.
- If the user gave a custom prompt, adapt it to English while preserving the requested safe transformation/effect.
- If the user chose random, decide what should naturally happen next based on the image.

chroma rules:
- Choose a solid backgroundHex that is clearly absent from the visible subject, semi-transparent antialiasing edges, clothes, props, hair, skin, eyes, shadows, highlights, and important details.
- Choose any pure, saturated, solid RGB hex color that is far from the entire visible subject and its outline/edges.
- The best background color is the one least likely to be removed from the subject by chromakey.
- Prefer very artificial chroma-like colors over natural colors.

Do not return markdown or explanations.`;
const VIDEO_CHROMA_REMOVAL_SYSTEM = `You inspect a single video frame and decide whether it has a removable chroma-key background.

Return only compact JSON with exactly these fields:
{"confident":true,"backgroundHex":"00FF00","reason":"short reason"}

Rules:
- Set confident=true only when the frame has a mostly solid artificial chroma background that can be removed safely.
- The background should be a flat or near-flat color behind the subject, such as green, blue, magenta, cyan, or another saturated studio/key color.
- Do not guess if the background is natural, detailed, gradient-heavy, similar to the subject, or only a tiny colored area.
- Pick the dominant removable background color as backgroundHex.
- If not confident, return confident=false with the best observed backgroundHex if useful and a short reason.
- Do not mention blur or boxblur.`;
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
  return {
    backgroundHex,
    similarity: DEFAULT_CHROMA_KEY_SETTINGS.similarity,
    blur: DEFAULT_CHROMA_KEY_SETTINGS.blur
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

function normalizeVideoChromaRemovalSettings(value) {
  const rawHex = String(value?.backgroundHex || value?.color || '')
    .replace(/^#/, '')
    .trim()
    .toUpperCase();
  const confident = value?.confident === true;

  return {
    confident,
    backgroundHex: /^[0-9A-F]{6}$/.test(rawHex)
      ? rawHex
      : DEFAULT_CHROMA_KEY_SETTINGS.backgroundHex,
    similarity: DEFAULT_CHROMA_KEY_SETTINGS.similarity,
    reason: String(value?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 240)
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
              text: 'Look at the visible subject only. Choose the best solid chroma-key background color.'
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

  async chooseVideoChromaRemovalSettings(frameImageUrl) {
    if (!frameImageUrl) {
      return {
        confident: false,
        backgroundHex: DEFAULT_CHROMA_KEY_SETTINGS.backgroundHex,
        similarity: DEFAULT_CHROMA_KEY_SETTINGS.similarity,
        reason: 'No frame image URL was provided.'
      };
    }

    try {
      const response = await this.requestWithProviders([
        { role: 'system', content: VIDEO_CHROMA_REMOVAL_SYSTEM },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Inspect this video frame. If it has a clearly removable chroma-key background, choose the exact background color. If not, return confident=false.'
            },
            {
              type: 'image_url',
              image_url: {
                url: frameImageUrl
              }
            }
          ]
        }
      ], {
        temperature: 0.1,
        topP: 0.5
      });

      return normalizeVideoChromaRemovalSettings(extractJsonObject(response));
    } catch (error) {
      return {
        confident: false,
        backgroundHex: DEFAULT_CHROMA_KEY_SETTINGS.backgroundHex,
        similarity: DEFAULT_CHROMA_KEY_SETTINGS.similarity,
        reason: error?.message || 'Chroma analysis failed.'
      };
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
