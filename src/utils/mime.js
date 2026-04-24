import path from 'node:path';

const mimeByExtension = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif']
]);

export function getMimeTypeFromPath(filePath) {
  return mimeByExtension.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}
