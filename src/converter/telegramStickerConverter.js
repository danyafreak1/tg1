import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from '../config/env.js';
import { probeMedia } from '../ffmpeg/ffprobe.js';
import { runBinary } from '../ffmpeg/process.js';
import { AppError } from '../utils/errors.js';

function buildScaleFilter(forceSquare = false) {
  const side = config.stickerSidePx;
  if (forceSquare) {
    return [
      `fps={FPS}`,
      `scale=${side}:${side}:force_original_aspect_ratio=increase:force_divisible_by=2`,
      `crop=${side}:${side}`
    ].join(',');
  }

  const filters = [
    `fps={FPS}`,
    `scale=${side}:${side}:force_original_aspect_ratio=decrease:force_divisible_by=2`
  ];

  filters.push('format=yuva420p');

  return filters.join(',');
}

function buildRoundedCornersFilter(radius) {
  if (!radius || radius <= 0) {
    return null;
  }

  const dx = 'min(X,W-1-X)';
  const dy = 'min(Y,H-1-Y)';
  const mask = `if(gte(${dx}\\,${radius})+gte(${dy}\\,${radius})\\,alpha(X,Y)\\,if(lte(pow(${dx}-${radius}\\,2)+pow(${dy}-${radius}\\,2)\\,pow(${radius}\\,2))\\,alpha(X,Y)\\,0))`;
  return `geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='${mask}'`;
}

function buildImageFilter({ roundedCorners, forceSquare = false }) {
  const side = config.stickerSidePx;
  const filters = forceSquare
    ? [
        `scale=${side}:${side}:force_original_aspect_ratio=increase`,
        `crop=${side}:${side}`
      ]
    : [
        `scale=${side}:${side}:force_original_aspect_ratio=decrease`
      ];

  filters.push(
    'format=rgba'
  );
  if (roundedCorners) {
    filters.push(buildRoundedCornersFilter(36));
  }
  return filters.join(',');
}

function buildAiVideoReferenceFilter() {
  return [
    "scale='ceil(iw*max(1\\,max(300/iw\\,300/ih)))':'ceil(ih*max(1\\,max(300/iw\\,300/ih)))'",
    'format=rgba'
  ].join(',');
}

function buildCropToAspectRatioFilter(targetRatio) {
  return [
    `crop=w='if(gt(iw/ih\\,${targetRatio})\\,floor(ih*${targetRatio}/2)*2\\,iw)':h='if(gt(iw/ih\\,${targetRatio})\\,ih\\,floor(iw/${targetRatio}/2)*2)':x='(iw-ow)/2':y='(ih-oh)/2'`,
    'format=rgba'
  ].join(',');
}

function buildAdminThumbnailFilter(maxSide = 50) {
  return [
    `scale='if(gte(iw\\,ih)\\,${maxSide}\\,-1)':'if(gte(ih\\,iw)\\,${maxSide}\\,-1)'`,
    'format=rgba'
  ].join(',');
}

function buildBlurredImageFilter(blur = '6:2') {
  return [
    `boxblur=${blur}`,
    'format=rgba'
  ].join(',');
}

function buildFlattenOnSolidBackgroundFilter(width, height, backgroundHex) {
  return [
    `color=c=0x${backgroundHex}:s=${width}x${height}[bg]`,
    '[bg][0:v]overlay=format=auto,format=rgb24'
  ].join(';');
}

function buildVideoFilter({ fps, roundedCorners, forceSquare = false }) {
  const filters = [buildScaleFilter(forceSquare).replace('{FPS}', String(fps))];
  if (roundedCorners) {
    filters.push(buildRoundedCornersFilter(36));
  }
  return filters.join(',');
}

function buildArgs({ inputPath, outputPath, fps, crf, roundedCorners, forceSquare = false }) {
  return [
    '-y',
    '-i',
    inputPath,
    '-t',
    String(config.stickerDurationLimitSec),
    '-an',
    '-c:v',
    'libvpx-vp9',
    '-pix_fmt',
    'yuva420p',
    '-vf',
    buildVideoFilter({ fps, roundedCorners, forceSquare }),
    '-b:v',
    '0',
    '-crf',
    String(crf),
    '-deadline',
    'good',
    '-cpu-used',
    '2',
    '-row-mt',
    '1',
    outputPath
  ];
}

export class TelegramStickerConverter {
  async probeVisualStream(filePath) {
    const { stdout } = await runBinary(
      'ffprobe',
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_entries',
        'stream=codec_type,width,height,pix_fmt:stream_tags=alpha_mode',
        filePath
      ],
      config.ffmpegTimeoutMs
    );

    const parsed = JSON.parse(stdout);
    const stream = parsed.streams?.find((item) => item.codec_type === 'video') || parsed.streams?.[0];
    if (!stream) {
      throw new AppError('Unable to inspect visual stream.', 500);
    }

    return {
      width: Number(stream.width) || 0,
      height: Number(stream.height) || 0,
      pixelFormat: stream.pix_fmt || '',
      alphaMode: String(stream?.tags?.alpha_mode || stream?.tags?.ALPHA_MODE || '')
    };
  }

  async hasAlphaChannel(filePath) {
    const stream = await this.probeVisualStream(filePath);
    return /a/.test(stream.pixelFormat);
  }

  async flattenImageOnSolidBackground({ inputPath, outputPath, backgroundHex }) {
    const stream = await this.probeVisualStream(inputPath);
    await runBinary(
      'ffmpeg',
      [
        '-y',
        '-i',
        inputPath,
        '-frames:v',
        '1',
        '-an',
        '-filter_complex',
        buildFlattenOnSolidBackgroundFilter(stream.width, stream.height, backgroundHex),
        outputPath
      ],
      config.ffmpegTimeoutMs
    );
  }

  async prepareBlurredImageReference({ inputPath, outputPath, blur = '6:2' }) {
    await runBinary(
      'ffmpeg',
      [
        '-y',
        '-i',
        inputPath,
        '-frames:v',
        '1',
        '-an',
        '-vf',
        buildBlurredImageFilter(blur),
        outputPath
      ],
      config.ffmpegTimeoutMs
    );

    const stats = await fs.stat(outputPath);
    return {
      size: stats.size,
      outputPath,
      metadata: {
        type: 'image'
      },
      attempt: {
        label: `blurred-reference-${blur}`
      }
    };
  }

  async prepareAiVideoReference({ inputPath, outputPath }) {
    await runBinary(
      'ffmpeg',
      [
        '-y',
        '-i',
        inputPath,
        '-frames:v',
        '1',
        '-an',
        '-vf',
        buildAiVideoReferenceFilter(),
        outputPath
      ],
      config.ffmpegTimeoutMs
    );

    const stats = await fs.stat(outputPath);
    return {
      size: stats.size,
      outputPath,
      metadata: {
        type: 'image'
      },
      attempt: {
        label: 'ai-video-reference-png'
      }
    };
  }

  async cropImageToAspectRatio({ inputPath, outputPath, targetRatio }) {
    await runBinary(
      'ffmpeg',
      [
        '-y',
        '-i',
        inputPath,
        '-frames:v',
        '1',
        '-an',
        '-vf',
        buildCropToAspectRatioFilter(targetRatio),
        outputPath
      ],
      config.ffmpegTimeoutMs
    );

    const stats = await fs.stat(outputPath);
    return {
      size: stats.size,
      outputPath,
      metadata: {
        type: 'image'
      },
      attempt: {
        label: `crop-to-ratio-${targetRatio}`
      }
    };
  }

  async prepareImagePreview({ inputPath, outputPath, forceSquare = false }) {
    await runBinary(
      'ffmpeg',
      [
        '-y',
        '-i',
        inputPath,
        '-frames:v',
        '1',
        '-an',
        '-vf',
        buildImageFilter({ roundedCorners: false, forceSquare }),
        outputPath
      ],
      config.ffmpegTimeoutMs
    );

    const stats = await fs.stat(outputPath);
    return {
      size: stats.size,
      outputPath,
      metadata: {
        type: 'image'
      },
      attempt: {
        label: 'preview-png-normalized'
      }
    };
  }

  async prepareAdminThumbnail({ inputPath, outputPath, maxSide = 50 }) {
    await runBinary(
      'ffmpeg',
      [
        '-y',
        '-i',
        inputPath,
        '-frames:v',
        '1',
        '-an',
        '-vf',
        buildAdminThumbnailFilter(maxSide),
        outputPath
      ],
      config.ffmpegTimeoutMs
    );

    const stats = await fs.stat(outputPath);
    return {
      size: stats.size,
      outputPath,
      metadata: {
        type: 'image'
      },
      attempt: {
        label: 'admin-thumbnail-png'
      }
    };
  }

  async convert({ inputPath, outputPath, roundedCorners = false, inputType = 'video', forceSquare = false }) {
    if (inputType === 'image') {
      return this.convertImage({ inputPath, outputPath, roundedCorners, forceSquare });
    }

    return this.convertVideo({ inputPath, outputPath, roundedCorners, forceSquare });
  }

  async convertVideo({ inputPath, outputPath, roundedCorners = false, forceSquare = false }) {
    const metadata = await probeMedia(inputPath);
    const attempts = [
      { fps: 30, crf: 34, label: 'quality-pass-1' },
      { fps: 30, crf: 38, label: 'quality-pass-2' },
      { fps: 30, crf: 42, label: 'quality-pass-3' },
      { fps: 24, crf: 46, label: 'size-pass-4' }
    ];

    let lastSize = 0;

    for (const attempt of attempts) {
      await runBinary('ffmpeg', buildArgs({
        inputPath,
        outputPath,
        fps: attempt.fps,
        crf: attempt.crf,
        roundedCorners,
        forceSquare
      }), config.ffmpegTimeoutMs);

      const stats = await fs.stat(outputPath);
      lastSize = stats.size;

      if (stats.size <= config.stickerMaxSizeBytes) {
        return {
          size: stats.size,
          metadata,
          attempt
        };
      }
    }

    throw new AppError(
      `Unable to fit the sticker into Telegram's ~256 KB limit. Last output size: ${lastSize} bytes. Try a shorter or simpler source video.`
    );
  }

  async convertImage({ inputPath, outputPath, roundedCorners = false, forceSquare = false }) {
    const finalPath = path.extname(outputPath).toLowerCase() === '.webp'
      ? outputPath
      : `${outputPath}.webp`;

    await runBinary(
      'ffmpeg',
      [
        '-y',
        '-i',
        inputPath,
        '-frames:v',
        '1',
        '-an',
        '-c:v',
        'libwebp',
        '-pix_fmt',
        'bgra',
        '-lossless',
        '1',
        '-preset',
        'picture',
        '-vf',
        buildImageFilter({ roundedCorners, forceSquare }),
        finalPath
      ],
      config.ffmpegTimeoutMs
    );

    const stats = await fs.stat(finalPath);
    return {
      size: stats.size,
      outputPath: finalPath,
      metadata: {
        type: 'image'
      },
      attempt: {
        label: 'static-webp-lossless'
      }
    };
  }
}
