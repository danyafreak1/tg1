import { promises as fs } from 'node:fs';
import { fileExists } from './files.js';

export class JsonStore {
  constructor(filePath, defaultValue) {
    this.filePath = filePath;
    this.defaultValue = defaultValue;
    this.cache = null;
  }

  async read() {
    if (this.cache) {
      return this.cache;
    }

    if (!(await fileExists(this.filePath))) {
      this.cache = structuredClone(this.defaultValue);
      await this.write(this.cache);
      return this.cache;
    }

    const raw = await fs.readFile(this.filePath, 'utf8');
    const sanitized = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    this.cache = sanitized.trim() ? JSON.parse(sanitized) : structuredClone(this.defaultValue);
    return this.cache;
  }

  async write(value) {
    this.cache = value;
    await fs.writeFile(this.filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return value;
  }

  async update(updater) {
    const current = await this.read();
    const next = await updater(structuredClone(current));
    return this.write(next);
  }
}
