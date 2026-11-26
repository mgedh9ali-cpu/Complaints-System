'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const REPOSITORY = 'mgedh9ali-cpu/Complaints-System';
const API = 'https://api.github.com/repos/' + REPOSITORY;

function versionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(version || '');
  if (!match) throw new Error('رقم إصدار غير مدعوم.');
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? Infinity : Number(match[4])];
}
function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
function selectRelease(releases, currentVersion, completedTag, installedCommit) {
  if (!Array.isArray(releases)) throw new Error('تعذر قراءة قائمة التحديثات.');
  const candidates = releases.filter(release => !release.draft && /^v\d+\.\d+\.\d+(?:-rc\.\d+)?-build\.[a-f0-9]{40}$/.test(release.tag_name || ''));
  candidates.sort((a, b) => compareVersions(b.tag_name.slice(1).split('-build.')[0], a.tag_name.slice(1).split('-build.')[0]) || Date.parse(b.published_at) - Date.parse(a.published_at));
  const release = candidates[0];
  if (!release || release.tag_name === completedTag) return null;
  const [version, commit] = release.tag_name.slice(1).split('-build.');
  if (compareVersions(version, currentVersion) < 0) return null;
  // A fresh installation has no receipt, but its embedded commit is authoritative.
  if (version === currentVersion && commit === installedCommit) return null;
  const name = 'complaints-system-' + version + '-setup.exe';
  const asset = release.assets?.find(item => item.name === name);
  if (!asset || asset.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 1024 ** 3 || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) throw new Error('حزمة التحديث غير مكتملة أو لا تحتوي بصمة تحقق.');
  const url = new URL(asset.browser_download_url);
  if (url.protocol !== 'https:' || url.host !== 'github.com' || url.username || url.password || url.search || url.hash || url.pathname !== '/' + REPOSITORY + '/releases/download/' + release.tag_name + '/' + name) throw new Error('مصدر حزمة التحديث غير معتمد.');
  if (!Number.isSafeInteger(asset.id) || asset.id <= 0) throw new Error('معرّف حزمة التحديث غير صالح.');
  return { version, commit, tag: release.tag_name, notes: String(release.body || 'لم تُنشر ملاحظات لهذا الإصدار.').slice(0, 16000), publishedAt: release.published_at || null, url: url.href, assetUrl: API + '/releases/assets/' + asset.id, size: asset.size, sha256: asset.digest.slice(7) };
}
async function downloadVerified({ fetch, release, destination, signal, onProgress = () => {} }) {
  const response = await fetch(release.assetUrl || release.url, { headers: { Accept: 'application/octet-stream' }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30 * 60000)]) : AbortSignal.timeout(30 * 60000) });
  if (!response.ok || !response.body) throw new Error('تعذر تنزيل حزمة التحديث: ' + response.status);
  const hash = crypto.createHash('sha256');
  const output = await fs.promises.open(destination, 'wx', 0o600);
  let written = 0;
  const started = Date.now();
  let lastReport = 0;
  try {
    for await (const chunk of response.body) {
      signal?.throwIfAborted();
      written += chunk.length;
      if (written > release.size) throw new Error('حجم التحديث غير مطابق.');
      hash.update(chunk);
      await output.writeFile(chunk);
      const now = Date.now();
      if (now - lastReport >= 200 || written === release.size) {
        lastReport = now;
        onProgress(Math.floor(written * 100 / release.size), { downloaded: written, total: release.size, speed: Math.round(written * 1000 / Math.max(1, now - started)) });
      }
    }
    signal?.throwIfAborted();
    await output.close();
    if (written !== release.size || hash.digest('hex') !== release.sha256) throw new Error('فشل التحقق من سلامة ملف التحديث؛ لم يُثبّت.');
  } catch (error) {
    await output.close();
    fs.rmSync(destination, { force: true });
    throw error;
  }
}
function createReleaseFetch(netFetch, token) {
  return async (input, options = {}) => {
    let url = new URL(input);
    for (let redirects = 0; redirects < 6; redirects++) {
      const api = url.origin === 'https://api.github.com' && url.pathname.startsWith('/repos/' + REPOSITORY + '/releases');
      const asset = url.protocol === 'https:' && ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname);
      if ((!api && !asset) || url.username || url.password) throw new Error('وجهة تنزيل غير معتمدة.');
      const headers = { ...options.headers };
      if (api && token) headers.Authorization = 'Bearer ' + token;
      const response = await netFetch(url.href, { ...options, headers, credentials: 'omit', redirect: 'manual' });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('وجهة تنزيل مفقودة.');
      url = new URL(location, url);
    }
    throw new Error('تجاوز عدد تحويلات التنزيل.');
  };
}
async function fileHash(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
module.exports = { API, selectRelease, compareVersions, downloadVerified, fileHash, createReleaseFetch };
