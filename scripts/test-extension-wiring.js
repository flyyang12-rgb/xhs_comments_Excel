const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionDir = path.join(__dirname, '..', 'xhs_chrome_extension');
const popupHtml = fs.readFileSync(path.join(extensionDir, 'popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.join(extensionDir, 'popup.js'), 'utf8');
const backgroundJs = fs.readFileSync(path.join(extensionDir, 'background.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

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
assert.match(backgroundJs, /importScripts\(['"]excel\.js['"],\s*['"]search-config\.js['"],\s*['"]note-links\.js['"]\)/);
assert.match(backgroundJs, /buildSearchNotesPayload\([\s\S]*noteType:\s*typeOption\.value,[\s\S]*noteTime:\s*timeOption\.value/);

assert.match(popupHtml, /id=['"]keywordModeBtn['"]/);
assert.match(popupHtml, /id=['"]linkModeBtn['"]/);
assert.match(popupHtml, /id=['"]noteLinks['"]/);
assert.match(popupHtml, /id=['"]appVersion['"]/);
assert.match(popupJs, /type:\s*['"]START_LINK_COLLECT['"][\s\S]*rawText,[\s\S]*delaySeconds/);
assert.match(backgroundJs, /async function runLinkCollection/);
assert.match(backgroundJs, /message\?\.type === ['"]START_LINK_COLLECT['"]/);
assert.doesNotMatch(popupHtml, /id=['"]importBtn['"]/);
assert.match(popupHtml, /id=['"]advancedFilters['"]/);
assert.match(popupHtml, /id=['"]finishCurrentBtn['"]/);
assert.match(popupHtml, /id=['"]immediateStopBtn['"]/);
assert.match(popupJs, /type:\s*['"]STOP_AFTER_CURRENT['"]/);
assert.match(backgroundJs, /message\?\.type === ['"]STOP_AFTER_CURRENT['"]/);
assert.match(backgroundJs, /abortActiveWork\(\)/);
assert.match(backgroundJs, /function resultSummary[\s\S]*completedNotes[\s\S]*评论[\s\S]*回复/);
assert.doesNotMatch(popupJs, /progressLabel/);
assert.equal(manifest.version, packageJson.version);

console.log('extension search and note-link wiring tests passed');
