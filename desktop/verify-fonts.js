'use strict';

// Release smoke tests must prove that Chromium renders the bundled Arabic font.
// This runs only on an isolated synthetic release profile, never on user data.
async function verifyRenderedFonts(webContents) {
  const weights = await webContents.executeJavaScript(`(async () => {
    const sample = 'الاستفسارات والشكاوى 0123456789';
    return Promise.all([300,400,500,700,900].map(async weight => {
      const faces = await document.fonts.load(weight + ' 18px "Thmanyah Sans"', sample);
      return {weight, loaded: faces.length > 0 && faces.every(face => face.status === 'loaded')};
    }));
  })()`);
  if (weights.length !== 5 || weights.some(result => !result.loaded)) {
    throw new Error('Bundled Thmanyah fonts failed to decode in Chromium.');
  }
  const debuggerApi = webContents.debugger;
  debuggerApi.attach('1.3');
  try {
    await debuggerApi.sendCommand('DOM.enable');
    await debuggerApi.sendCommand('CSS.enable');
    const {root} = await debuggerApi.sendCommand('DOM.getDocument');
    const {nodeId} = await debuggerApi.sendCommand('DOM.querySelector', {nodeId: root.nodeId, selector: '#loginTitle'});
    if (!nodeId) throw new Error('Login font verification target is missing.');
    const {fonts} = await debuggerApi.sendCommand('CSS.getPlatformFontsForNode', {nodeId});
    if (!fonts.length || fonts.some(font => !font.isCustomFont || !/thmanyah/i.test(font.familyName) || font.glyphCount < 1)) {
      throw new Error('Login text rendered with a fallback instead of bundled Thmanyah.');
    }
    return {ok: true, weights, fonts};
  } finally {
    debuggerApi.detach();
  }
}

module.exports = {verifyRenderedFonts};
