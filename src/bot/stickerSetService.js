import { promises as fs } from 'node:fs';
import { AppError } from '../utils/errors.js';

export class StickerSetService {
  constructor({ token, botUsername }) {
    this.token = token;
    this.botUsername = botUsername;
  }

  async callApi(method, payload, fileField = null) {
    const url = `https://api.telegram.org/bot${this.token}/${method}`;
    let response;

    if (fileField) {
      const form = new FormData();
      for (const [key, value] of Object.entries(payload)) {
        if (key === fileField.name) {
          continue;
        }

        form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
      }

      const fileBuffer = await fs.readFile(fileField.path);
      form.append(fileField.name, new Blob([fileBuffer]), fileField.filename);
      response = await fetch(url, { method: 'POST', body: form });
    } else {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const data = await response.json();
    if (!data.ok) {
      throw new AppError(data.description || `Telegram API method ${method} failed`, 400);
    }

    return data.result;
  }

  normalizeSetName(shortName) {
    const base = shortName
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');

    const suffix = `_by_${this.botUsername.toLowerCase()}`;
    const maxBaseLength = 64 - suffix.length;
    const trimmedBase = base.slice(0, Math.max(1, maxBaseLength)).replace(/_+$/g, '') || 'pack';
    const withLetterPrefix = /^[a-z]/.test(trimmedBase) ? trimmedBase : `pack_${trimmedBase}`;
    const trimmed = withLetterPrefix.slice(0, maxBaseLength).replace(/_+$/g, '') || 'pack';
    return `${trimmed}${suffix}`;
  }

  async uploadStickerFile({ userId, stickerPath, stickerFormat }) {
    const file = await this.callApi(
      'uploadStickerFile',
      {
        user_id: String(userId),
        sticker_format: stickerFormat
      },
      {
        name: 'sticker',
        path: stickerPath,
        filename: stickerFormat === 'static' ? 'sticker.webp' : 'sticker.webm'
      }
    );

    return file.file_id;
  }

  async resolveStickerFileId({ userId, stickerPath, stickerFormat, stickerFileId = null }) {
    if (stickerFileId) {
      return stickerFileId;
    }

    return this.uploadStickerFile({ userId, stickerPath, stickerFormat });
  }

  async createNewSet({ userId, title, shortName, emoji, stickerPath, stickerFormat, stickerFileId = null }) {
    const fileId = await this.resolveStickerFileId({ userId, stickerPath, stickerFormat, stickerFileId });
    const name = this.normalizeSetName(shortName);

    await this.callApi('createNewStickerSet', {
      user_id: String(userId),
      name,
      title,
      sticker_type: 'regular',
      stickers: [
        {
          sticker: fileId,
          format: stickerFormat,
          emoji_list: [emoji]
        }
      ]
    });

    return {
      name,
      title,
      addUrl: `https://t.me/addstickers/${name}`,
      fileId
    };
  }

  async addToSet({ userId, setName, emoji, stickerPath, stickerFormat, stickerFileId = null }) {
    const fileId = await this.resolveStickerFileId({ userId, stickerPath, stickerFormat, stickerFileId });

    await this.callApi('addStickerToSet', {
      user_id: String(userId),
      name: setName,
      sticker: {
        sticker: fileId,
        format: stickerFormat,
        emoji_list: [emoji]
      }
    });

    return {
      setName,
      addUrl: `https://t.me/addstickers/${setName}`,
      fileId
    };
  }

  async getStickerSet(name) {
    return this.callApi('getStickerSet', { name });
  }

  async deleteStickerFromSet(stickerFileId) {
    return this.callApi('deleteStickerFromSet', { sticker: stickerFileId });
  }

  async deleteStickerSet(name) {
    return this.callApi('deleteStickerSet', { name });
  }
}
