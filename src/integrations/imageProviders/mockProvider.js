import { promises as fs } from 'node:fs';

export class MockImageProvider {
  constructor({ outputExtension = '.png' } = {}) {
    this.outputExtension = outputExtension;
  }

  async generate({ sourceImagePath, outputPath }) {
    await fs.copyFile(sourceImagePath, outputPath);
    return {
      outputPath,
      mimeType: 'image/png',
      revisedPrompt: null,
      provider: 'mock'
    };
  }
}
