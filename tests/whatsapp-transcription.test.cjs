'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalTranscriber } = require('../modules/whatsapp/transcription');

const files = { ffmpeg: process.execPath, whisper: process.execPath, model: __filename };

test('supplies a valid 16 kHz WAV over stdin and returns editable Arabic transcription', async () => {
  const input = Buffer.from('test input');
  const service = createLocalTranscriber({
    ...files,
    run: async (_exe, args, bytes) => {
      if (args.includes('-protocol_whitelist')) {
        assert.equal(args[args.indexOf('-protocol_whitelist') + 1], 'pipe');
        assert.equal(bytes, input);
        return Buffer.from([12, 34, 56, 78]);
      }
      assert.equal(args[args.indexOf('-f') + 1], '-');
      assert.equal(args[args.indexOf('-l') + 1], 'ar');
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(bytes.readUInt32LE(4), bytes.length - 8);
      assert.equal(bytes.readUInt32LE(24), 16000);
      assert.equal(bytes.readUInt16LE(34), 16);
      assert.equal(bytes.readUInt32LE(40), 4);
      assert.deepEqual([...bytes.subarray(44)], [12, 34, 56, 78]);
      return Buffer.from(' \n هذه شكوى تجريبية \n');
    }
  });
  assert.deepEqual(await service.transcribe(input), { status: 200, transcript: 'هذه شكوى تجريبية' });
});

test('leaves manual entry available when tools are missing and rejects clips above the duration limit', async () => {
  assert.equal((await createLocalTranscriber({ ...files, whisper: '' }).transcribe(Buffer.alloc(0))).status, 503);
  let calls = 0;
  const service = createLocalTranscriber({
    ...files,
    run: async () => {
      calls++;
      return Buffer.alloc(16000 * 2 * 300 + 2);
    }
  });
  assert.equal((await service.transcribe(Buffer.alloc(0))).status, 422);
  assert.equal(calls, 1);
});

test('rejects concurrent jobs and releases the slot after errors without leaking details', async () => {
  let fail;
  const service = createLocalTranscriber({
    ...files,
    run: () => new Promise((_resolve, reject) => { fail = reject; })
  });
  const first = service.transcribe(Buffer.alloc(0));
  assert.equal((await service.transcribe(Buffer.alloc(0))).status, 409);
  fail(new Error('private details'));
  const result = await first;
  assert.equal(result.status, 422);
  assert.doesNotMatch(result.error, /private/);
  const retry = service.transcribe(Buffer.alloc(0));
  fail(new Error('retry'));
  assert.equal((await retry).status, 422);
});
