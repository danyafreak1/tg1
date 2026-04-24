import express from 'express';
import path from 'node:path';
import { config } from '../config/env.js';
import { AppError, toPublicError } from '../utils/errors.js';

function requireAdminToken(req, _res, next) {
  if (!config.adminToken) {
    next();
    return;
  }

  const token = req.get('x-admin-token') || req.query.token;
  if (token !== config.adminToken) {
    next(new AppError('Admin token is required.', 401));
    return;
  }

  next();
}

export function createAdminRouter({ publicDir, userState, stickerSets }) {
  const router = express.Router();

  router.get('/admin', (_req, res) => {
    res.sendFile(path.join(publicDir, 'admin.html'));
  });

  router.get('/api/admin/stickers', requireAdminToken, async (_req, res) => {
    try {
      if (!stickerSets) {
        throw new AppError('Bot token is not configured, admin sticker view is unavailable.', 400);
      }

      const users = await userState.getAllUsers();
      const items = [];

      for (const [userId, user] of Object.entries(users)) {
        for (const localSet of user.stickerSets || []) {
          try {
            const liveSet = await stickerSets.getStickerSet(localSet.name);
            const localStickers = localSet.stickers || [];
            items.push({
              userId,
              set: {
                name: liveSet.name,
                title: liveSet.title,
                stickerType: liveSet.sticker_type,
                stickerCount: liveSet.stickers?.length || 0,
                addUrl: `https://t.me/addstickers/${liveSet.name}`,
                createdAt: localSet.createdAt || null
              },
              stickers: (liveSet.stickers || []).map((sticker) => {
                const localSticker = localStickers.find((item) =>
                  item.fileId === sticker.file_id ||
                  item.fileUniqueId === sticker.file_unique_id
                );

                return {
                  fileId: sticker.file_id,
                  uniqueId: sticker.file_unique_id,
                  emoji: (sticker.emoji || '').trim() || '-',
                  width: sticker.width,
                  height: sticker.height,
                  isVideo: Boolean(sticker.is_video),
                  sourceOriginalName: localSticker?.sourceOriginalName || null,
                  sourceJobId: localSticker?.sourceJobId || null,
                  addedAt: localSticker?.addedAt || null
                };
              })
            });
          } catch (error) {
            items.push({
              userId,
              set: {
                name: localSet.name,
                title: localSet.title,
                stickerType: 'unknown',
                stickerCount: 0,
                addUrl: `https://t.me/addstickers/${localSet.name}`,
                createdAt: localSet.createdAt || null,
                error: error.message
              },
              stickers: []
            });
          }
        }
      }

      res.json({ items });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: toPublicError(error) });
    }
  });

  router.delete('/api/admin/stickers/:fileId', requireAdminToken, async (req, res) => {
    try {
      if (!stickerSets) {
        throw new AppError('Bot token is not configured, sticker deletion is unavailable.', 400);
      }

      await stickerSets.deleteStickerFromSet(req.params.fileId);
      res.json({ ok: true });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: toPublicError(error) });
    }
  });

  router.delete('/api/admin/sets/:name', requireAdminToken, async (req, res) => {
    try {
      if (!stickerSets) {
        throw new AppError('Bot token is not configured, set deletion is unavailable.', 400);
      }

      const setName = req.params.name;
      await stickerSets.deleteStickerSet(setName);
      await userState.removeStickerSetFromAllUsers(setName);
      res.json({ ok: true });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: toPublicError(error) });
    }
  });

  return router;
}
