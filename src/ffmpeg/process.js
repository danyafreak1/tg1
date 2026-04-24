import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../utils/errors.js';
import { config } from '../config/env.js';

const execFileAsync = promisify(execFile);

const binaryCache = new Map();

async function resolveBinary(command) {
  if (binaryCache.has(command)) {
    return binaryCache.get(command);
  }

  const configured = command === 'ffmpeg' ? config.ffmpegPath : config.ffprobePath;
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-8.1-full_build', 'bin', `${command}.exe`),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-7.1-full_build', 'bin', `${command}.exe`),
    path.join('C:\\', 'ffmpeg', 'bin', `${command}.exe`),
    path.join(process.env.USERPROFILE || '', 'scoop', 'apps', 'ffmpeg', 'current', 'bin', `${command}.exe`)
  ];

  if (configured) {
    if (path.isAbsolute(configured)) {
      candidates.unshift(configured);
    } else {
      candidates.push(configured);
    }
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (path.isAbsolute(candidate)) {
      try {
        await access(candidate);
        binaryCache.set(command, candidate);
        return candidate;
      } catch {
        continue;
      }
    }

    binaryCache.set(command, candidate);
    return candidate;
  }

  binaryCache.set(command, configured);
  return configured;
}

export async function runBinary(command, args, timeoutMs) {
  const resolvedCommand = await resolveBinary(command);

  try {
    return await execFileAsync(resolvedCommand, args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new AppError(
        `${command} not found. Install ffmpeg and make sure both ffmpeg and ffprobe are available from the terminal or configure FFMPEG_PATH/FFPROBE_PATH.`,
        500
      );
    }

    if (error?.killed || error?.signal === 'SIGTERM') {
      throw new AppError(`${command} timed out`, 500);
    }

    const stderr = error?.stderr?.toString().trim();
    throw new AppError(`${command} failed${stderr ? `: ${stderr}` : ''}`, 500);
  }
}
