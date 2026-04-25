import { config } from '../config/env.js';

const CUSTOM_PROMPT_SYSTEM = `You adapt user requests into short English Seedance-ready directions for reference-based image-to-video generation.

Rules:
- Output only one short English direction for the requested effect or motion.
- Never restate or invent the subject's gender, age, body, clothes, hair, ethnicity, or identity unless the user explicitly asks to transform them.
- Never describe the background, camera angle, lighting, or composition unless the user explicitly asks to change them.
- Assume the reference image defines the subject and scene. Preserve them unless the user explicitly requests a change.
- Optimize for a 3-second square sticker-like video.
- Keep the request stable, concise, and easy for image-to-video generation.
- Avoid extra characters, scene changes, text overlays, surreal transformations, violence, hostile gestures, and explicit sexual content.
- If the user explicitly asks for a visual transformation or magical effect, keep that transformation in the output in a short, practical way. Do not replace it with generic motion.
- Explicit requests like sparkles, magical aura, fairy transformation, wings, outfit change, glowing effects, or beauty transformation should stay in the final direction if they are safe.
- If the user asks for something risky or hostile, rewrite it into the closest safe, non-hostile, non-graphic version while keeping the basic creative idea.
- Good outputs are like: "Add soft blinking and gentle breathing." / "Add sparkling magic particles around her and transform her into a fairy-like magical version."
- Do not wrap your answer in quotes.`;

const RANDOM_PROMPT_SYSTEM = `You are looking at a reference image for a 3-second Seedance sticker video.

Your job:
- First understand what the main visible subject is.
- Then choose the most obvious, natural, low-risk motion that fits that exact subject.
- Base the motion on what is actually visible in the image. Do not ignore the reference.
- Do not restate or invent the subject's gender, age, body, clothes, hair, ethnicity, identity, or background details unless they are directly needed for the motion.
- Preserve the exact subject and all visual content from the reference image.
- Prefer the first obvious motion idea for the visible subject:
  - if it is a person or animal: blinking, breathing, tiny head tilt, small smile, soft glance, gentle hair sway, slight hand adjustment, playful shoulder sway, tiny nod, light reaction gesture
  - if it is an object or icon: gentle bobbing, tiny rotation, subtle floating, soft bounce, slight wobble, light shimmer, small rocking motion, slow spin, springy hop, drifting sway, lively tilt
  - if it is food or a simple illustration: tiny bounce, soft wobble, slow float, slight turn, small jiggle, delicate shimmer, playful pop, buoyant sway
- Prefer a motion that feels a little more lively, charming, or playful when it still matches the subject naturally.
- It is okay to combine 2-3 tiny motions in one short line if they fit together well.
- Variation is good: do not default to blinking or breathing unless the subject clearly suggests that.
- For non-human subjects, prioritize motion that feels object-like instead of human-like.
- Keep the motion minimal enough for a short 3-second square sticker video, but give it more personality and visible movement when safe.
- Keep the background unchanged.
- Avoid scene changes, extra objects, hostile gestures, violence, surreal body changes, text, and explicit sexual content.
- Output only one short English motion direction, not an explanation.
- Good outputs are like: "Add a tiny floating wobble with a soft spin." / "Add a playful little bounce and a gentle tilt." / "Add a slow bobbing motion with a light shimmer." / "Add a subtle blink, a tiny smile, and a soft head tilt."`;

const DEFAULT_CUSTOM_DIRECTION = 'Add one subtle, believable motion with minimal movement.';
const DEFAULT_RANDOM_MOTION = 'Add a subtle blink and a slight natural movement.';

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

export class AiVideoPromptService {
  constructor({ providers = uniqueProviders(), timeoutMs = config.chatRequestTimeoutMs } = {}) {
    this.providers = providers;
    this.timeoutMs = timeoutMs;
  }

  async requestWithProviders(messages, temperature = 0.25) {
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
            temperature,
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

  async createRandomPromptFromImage(referenceImageUrl) {
    if (!referenceImageUrl) {
      return DEFAULT_RANDOM_MOTION;
    }

    try {
      const motion = await this.requestWithProviders([
        { role: 'system', content: RANDOM_PROMPT_SYSTEM },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Look at this reference image and write only one short English motion direction for a subtle 3-second square sticker video.'
            },
            {
              type: 'image_url',
              image_url: {
                url: referenceImageUrl
              }
            }
          ]
        }
      ], 0.95);
      return normalizeDirectionLine(motion, DEFAULT_RANDOM_MOTION);
    } catch {
      return DEFAULT_RANDOM_MOTION;
    }
  }
}
