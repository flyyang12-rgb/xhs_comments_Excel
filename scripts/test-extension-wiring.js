const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionDir = path.join(__dirname, '..', 'xhs_chrome_extension');
const popupHtml = fs.readFileSync(path.join(extensionDir, 'popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.join(extensionDir, 'popup.js'), 'utf8');
const backgroundJs = fs.readFileSync(path.join(extensionDir, 'background.js'), 'utf8');

for (const value of [
  'general',
  'time_descending',
  'popularity_descending',
  'comment_descending',
  'collect_descending'
]) {
  assert.match(popupHtml, new RegExp(`value=["']${value}["']`));
}

assert.match(popupHtml, /id=["']noteType["']/);
assert.match(popupHtml, /id=["']noteTime["']/);
assert.match(popupJs, /type:\s*['"]START_COLLECT['"][\s\S]*noteType,[\s\S]*noteTime,/);
assert.match(backgroundJs, /importScripts\(['"]excel\.js['"],\s*['"]search-config\.js['"]\)/);
assert.match(backgroundJs, /buildSearchNotesPayload\([\s\S]*noteType:\s*typeOption\.value,[\s\S]*noteTime:\s*timeOption\.value/);

console.log('extension search wiring tests passed');
