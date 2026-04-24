import express from 'express';
import path from 'node:path';
import { createApiRouter } from '../routes/apiRoutes.js';
import { createAdminRouter } from '../routes/adminRoutes.js';
import { toPublicError } from '../utils/errors.js';

export function createApp({ backend, storage, publicDir, userState, stickerSets }) {
  const app = express();
  app.use(express.json());
  app.use(express.static(publicDir));
  app.use(createApiRouter({ backend, storage, userState }));
  app.use(createAdminRouter({ publicDir, userState, stickerSets }));

  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({ error: toPublicError(error) });
  });

  return app;
}
