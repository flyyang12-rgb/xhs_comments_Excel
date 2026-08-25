const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createElement(id) {
  const listeners = {};
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    hidden: false,
    files: [],
    style: {},
    className: '',
    open: false,
    classList: { toggle() {}, remove() {} },
    setAttribute() {},
    focus() {},
    prepend() {},
    appendChild() {},
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    listeners
  };
}

const ids = [
  'appVersion', 'keywordModeBtn', 'linkModeBtn', 'keywordModePanel', 'linkModePanel',
  'keyword', 'noteLinks', 'limit', 'sortType', 'noteType', 'noteTime', 'delay', 'advancedFilters',
  'startBtn', 'stopBtn', 'exportBtn', 'stopDialog', 'finishCurrentBtn', 'immediateStopBtn', 'cancelStopBtn', 'stateBadge',
  'progressBar', 'statusText', 'noteCount', 'commentCount', 'replyCount', 'log'
];
const elements = Object.fromEntries(ids.map((id) => [id, createElement(id)]));
elements.keyword.value = '测试';
elements.noteLinks.value = 'https://www.xiaohongshu.com/explore/abc123';
elements.limit.value = '10';
elements.sortType.value = 'comment_descending';
elements.noteType.value = '0';
elements.noteTime.value = '0';
elements.delay.value = '6';
elements.stopDialog.hidden = true;

const idleState = {
  status: 'idle',
  mode: 'keyword',
  message: '等待输入关键词',
  progress: 0,
  notes: [],
  commentRows: [],
  commentCount: 0,
  replyCount: 0,
  logs: [],
  taskProgress: {}
};

const sentMessages = [];
const runtime = {
  getManifest: () => ({ version: '1.1.0' }),
  onMessage: { addListener() {} },
  sendMessage(message) {
    sentMessages.push(message);
    if (message.type === 'GET_STATE') {
      return Promise.resolve(idleState);
    }
    if (message.type === 'CHECK_LOGIN_STATUS') {
      return Promise.resolve({ ok: true, loggedIn: true });
    }
    if (message.type === 'START_LINK_COLLECT') {
      return Promise.reject(new Error('The message port closed before a response was received.'));
    }
    return Promise.resolve({ ok: true });
  }
};

const context = vm.createContext({
  chrome: { runtime },
  document: {
    body: { classList: { toggle() {} } },
    getElementById: (id) => elements[id],
    createElement: (tag) => createElement(tag)
  },
  TextDecoder,
  URL,
  URLSearchParams,
  console
});

const source = fs.readFileSync(path.join(__dirname, '..', 'xhs_chrome_extension', 'popup.js'), 'utf8');
vm.runInContext(source, context, { filename: 'popup.js' });

(async () => {
  await Promise.resolve();
  await elements.linkModeBtn.listeners.click();
  let rejected = false;
  try {
    await elements.startBtn.listeners.click();
  } catch (_) {
    rejected = true;
  }
  assert.equal(rejected, false, '后台消息失败不应变成无提示的按钮异常');
  assert.match(elements.statusText.textContent, /重新加载/, '应明确提示用户重新加载插件');

  elements.stopBtn.listeners.click();
  assert.equal(elements.stopDialog.hidden, false, '点击停止后应显示二次选择');
  await elements.finishCurrentBtn.listeners.click();
  assert.equal(elements.stopDialog.hidden, true);
  assert.equal(sentMessages.at(-1).type, 'STOP_AFTER_CURRENT');
  assert.match(elements.statusText.textContent, /采完当前笔记后停止/);
  assert.equal(elements.stopBtn.textContent, '等待停止');
  assert.equal(elements.stopBtn.disabled, true);

  elements.stopBtn.disabled = false;
  elements.stopBtn.listeners.click();
  await elements.immediateStopBtn.listeners.click();
  assert.equal(sentMessages.at(-1).type, 'STOP_COLLECT');
  assert.match(elements.statusText.textContent, /正在立即停止/);
  assert.equal(elements.stopBtn.textContent, '正在停止…');
  assert.equal(elements.stopBtn.disabled, true);
  console.log('popup start feedback regression test passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
