import { randomUUID } from 'node:crypto';

export function createId(prefix = '') {
  return `${prefix}${randomUUID().replace(/-/g, '')}`;
}
