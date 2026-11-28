'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { statSync } = require('node:fs');

const SAMPLE_RATE = 16000;
const MAX_SECONDS = 300;

function runWithInput(executable, args, input, options) {
  return new Promise((resolve, reject) => {
    const child = execFile(executable, args, {
      encoding: 'buffer',
      windowsHide: true,
      ...options
    }, (error, output) => error ? reject(error) : resolve(output));
    child.stdin.on('error', () => {}); // Early exit is reported by execFile.
    child.stdin.end(input);
  });
}

function wavFromPcm(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // Mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function createLocalTranscriber({
  ffmpeg = process.env.WHATSAPP_FFMPEG_PATH,
  whisper = process.env.WHATSAPP_WHISPER_PATH,
  model = process.env.WHATSAPP_WHISPER_MODEL,
  run = runWithInput
} = {}) {
  const ready = [ffmpeg, whisper, model].every(file => {
    if (typeof file !== 'string' || !path.isAbsolute(file)) return false;
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  });
  let busy = false;

  async function transcribe(audio, signal) {
    if (!ready) return { status: 503, error: 'التفريغ الآلي يحتاج تهيئة FFmpeg وWhisper ونموذج متعدد اللغات على هذا الجهاز.' };
    if (busy) return { status: 409, error: 'يُفرّغ التطبيق تسجيلًا آخر. حاول بعد اكتماله.' };
    busy = true;
    try {
      // Explicitly demux Ogg and allow only stdin/stdout. No temporary media or URLs.
      const pcm = await run(ffmpeg, [
        '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'pipe',
        '-f', 'ogg', '-i', 'pipe:0', '-map', '0:a:0',
        '-t', String(MAX_SECONDS + 1), '-ac', '1', '-ar', String(SAMPLE_RATE),
        '-f', 's16le', 'pipe:1'
      ], audio, { timeout: 30_000, maxBuffer: SAMPLE_RATE * 2 * (MAX_SECONDS + 2), signal });
      if (pcm.length > SAMPLE_RATE * 2 * MAX_SECONDS) {
        return { status: 422, error: 'التفريغ الآلي متاح للتسجيلات التي لا تتجاوز خمس دقائق.' };
      }
      if (!pcm.length) return { status: 422, error: 'تعذّر قراءة الصوت من التسجيل.' };

      const output = await run(whisper, [
        '-m', model, '-f', '-', '-l', 'ar', '-nt', '-ng', '-sns'
      ], wavFromPcm(pcm), { timeout: 240_000, maxBuffer: 1024 * 1024, signal });
      const transcript = output.toString('utf8').trim();
      if (!transcript) return { status: 422, error: 'لم يظهر نص قابل للمراجعة في التسجيل.' };
      return { status: 200, transcript };
    } catch {
      // Child process errors may contain sensitive output and local paths.
      return { status: 422, error: 'تعذّر التفريغ المحلي. راجع إعداد الأدوات أو اكتب التفريغ يدويًا.' };
    } finally {
      busy = false;
    }
  }
  return { ready, transcribe };
}

module.exports = { createLocalTranscriber };
