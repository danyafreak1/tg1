import path from 'node:path';
import { promises as fs } from 'node:fs';

export function sanitizeFilename(input) {
  const ext = path.extname(input || '').slice(0, 10).replace(/[^a-zA-Z0-9.]/g, '');
  const base = path.basename(input || 'file', path.extname(input || 'file'))
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'file';

  return `${base}${ext}`;
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
