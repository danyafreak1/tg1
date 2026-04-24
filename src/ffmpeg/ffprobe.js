import { runBinary } from './process.js';
import { config } from '../config/env.js';
import { AppError } from '../utils/errors.js';

export async function probeMedia(filePath) {
  const { stdout } = await runBinary(
    'ffprobe',
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath
    ],
    config.ffmpegTimeoutMs
  );

  const parsed = JSON.parse(stdout);
  const videoStream = parsed.streams?.find((stream) => stream.codec_type === 'video');

  if (!videoStream) {
    throw new AppError('Input file does not contain a video stream.');
  }

  const duration =
    Number(videoStream.duration) ||
    Number(parsed.format?.duration) ||
    0;

  if (!duration || duration <= 0) {
    throw new AppError('Unable to determine video duration.');
  }

  if (duration > config.maxInputDurationSec) {
    throw new AppError(
      `Input video is too long for this MVP. Maximum allowed input duration is ${config.maxInputDurationSec} seconds.`
    );
  }

  return {
    duration,
    width: Number(videoStream.width) || 0,
    height: Number(videoStream.height) || 0,
    hasAudio: parsed.streams?.some((stream) => stream.codec_type === 'audio') || false,
    codecName: videoStream.codec_name || 'unknown',
    pixelFormat: videoStream.pix_fmt || 'unknown'
  };
}
