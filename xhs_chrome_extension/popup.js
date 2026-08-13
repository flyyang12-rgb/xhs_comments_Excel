const els = {
  appVersion: document.getElementById('appVersion'),
  keywordModeBtn: document.getElementById('keywordModeBtn'),
  linkModeBtn: document.getElementById('linkModeBtn'),
  keywordModePanel: document.getElementById('keywordModePanel'),
  linkModePanel: document.getElementById('linkModePanel'),
  keyword: document.getElementById('keyword'),
  noteLinks: document.getElementById('noteLinks'),
  limit: document.getElementById('limit'),
  sortType: document.getElementById('sortType'),
  noteType: document.getElementById('noteType'),
  noteTime: document.getElementById('noteTime'),
  delay: document.getElementById('delay'),
  advancedFilters: document.getElementById('advancedFilters'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  exportBtn: document.getElementById('exportBtn'),
  stopDialog: document.getElementById('stopDialog'),
  finishCurrentBtn: document.getElementById('finishCurrentBtn'),
  immediateStopBtn: document.getElementById('immediateStopBtn'),
  cancelStopBtn: document.getElementById('cancelStopBtn'),
  stateBadge: document.getElementById('stateBadge'),
  progressBar: document.getElementById('progressBar'),
  statusText: document.getElementById('statusText'),
  noteCount: document.getElementById('noteCount'),
  commentCount: document.getElementById('commentCount'),
  replyCount: document.getElementById('replyCount'),
  log: document.getElementById('log')
};

const runtime = globalThis.chrome?.runtime;
let loginStatus = 'checking';
let currentMode = 'keyword';

els.appVersion.textContent = `v${runtime?.getManifest?.().version || '1.1.0'}`;

const SORT_LABELS = {
  general: '综合',
  comment_descending: '最多评论',
  popularity_descending: '最多点赞',
  time_descending: '最新',
  collect_descending: '最多收藏'
};

function normalizedLimit() {
  const value = Math.trunc(Number(els.limit.value || 10));
  return Math.max(1, Math.min(20, Number.isFinite(value) ? value : 10));
}

function normalizedDelay() {
  if (currentMode === 'links') {
    return 6;
  }
  const input = els.delay;
  const value = Math.trunc(Number(input.value || 6));
  return Math.max(3, Math.min(30, Number.isFinite(value) ? value : 6));
}

function normalizedSortType() {
  const value = String(els.sortType.value || 'comment_descending');
  return SORT_LABELS[value] ? value : 'comment_descending';
}

function normalizedNoteType() {
  const value = Number(els.noteType.value || 0);
  return [0, 1, 2].includes(value) ? value : 0;
}

function normalizedNoteTime() {
  const value = Number(els.noteTime.value || 0);
  return [0, 1, 2, 3].includes(value) ? value : 0;
}

function syncLimitUi() {
  const limit = normalizedLimit();
  els.limit.value = String(limit);
  syncStartButton();
}

function syncDelayUi() {
  if (currentMode === 'keyword') {
    els.delay.value = String(normalizedDelay());
  }
}

function syncSortUi() {
  els.sortType.value = normalizedSortType();
  syncStartButton();
}

function syncStartButton() {
  els.startBtn.textContent = '开始采集';
}

function switchMode(mode) {
  currentMode = mode === 'links' ? 'links' : 'keyword';
  const isLinks = currentMode === 'links';
  els.keywordModeBtn.classList.toggle('active', !isLinks);
  els.linkModeBtn.classList.toggle('active', isLinks);
  els.keywordModeBtn.setAttribute('aria-selected', String(!isLinks));
  els.linkModeBtn.setAttribute('aria-selected', String(isLinks));
  els.keywordModePanel.hidden = isLinks;
  els.linkModePanel.hidden = !isLinks;
  document.body.classList.toggle('mode-links', isLinks);
  els.statusText.textContent = isLinks ? '等待粘贴笔记链接' : '等待输入关键词';
  syncDelayUi();
  syncStartButton();
}

function send(message) {
  return runtime?.sendMessage ? runtime.sendMessage(message) : Promise.resolve({ ok: false, preview: true });
}

function showStartError(error) {
  const rawText = String(error?.message || error || '');
  const backgroundNotReady = !rawText
    || rawText.includes('message port')
    || rawText.includes('Receiving end')
    || rawText.includes('Could not establish connection')
    || rawText.includes('插件后台未响应');
  const text = backgroundNotReady
    ? '插件后台尚未更新，请到扩展管理页重新加载插件'
    : rawText;
  els.statusText.textContent = text;
  addUiLog(text, 'error');
}

async function sendStart(message) {
  try {
    const result = await send(message);
    if (!result?.ok) {
      throw new Error(result?.error || '插件后台未响应');
    }
    return true;
  } catch (error) {
    showStartError(error);
    return false;
  }
}

function setLoginStatus(status) {
  loginStatus = ['checking', 'logged-in', 'logged-out'].includes(status) ? status : 'logged-out';
  renderBadge();
}

function renderBadge(status = 'idle') {
  const isBusy = status === 'running';
  const isError = status === 'error';
  els.stateBadge.classList.toggle('running', isBusy);
  els.stateBadge.classList.toggle('logged-in', !isBusy && !isError && loginStatus === 'logged-in');
  els.stateBadge.classList.toggle('logged-out', !isBusy && !isError && loginStatus === 'logged-out');
  els.stateBadge.classList.toggle('checking', !isBusy && !isError && loginStatus === 'checking');
  if (isBusy) {
    els.stateBadge.textContent = '采集中';
  } else if (isError) {
    els.stateBadge.textContent = '异常';
  } else if (loginStatus === 'logged-in') {
    els.stateBadge.textContent = '已登录';
  } else if (loginStatus === 'logged-out') {
    els.stateBadge.textContent = '未登录';
  } else {
    els.stateBadge.textContent = '检测中';
  }
}

function setBusy(isBusy) {
  if (isBusy && els.advancedFilters.open) {
    els.advancedFilters.open = false;
    document.body.classList.remove('filters-open');
  }
  els.startBtn.disabled = isBusy;
  els.stopBtn.disabled = !isBusy;
  els.keywordModeBtn.disabled = isBusy;
  els.linkModeBtn.disabled = isBusy;
  els.noteLinks.disabled = isBusy;
  document.body.classList.toggle('is-running', isBusy);
}

function renderStopState(state, isBusy) {
  const waitingForCurrent = isBusy && Boolean(state.stopAfterCurrent);
  const stoppingNow = isBusy && Boolean(state.stopRequested);
  els.stopBtn.disabled = !isBusy || waitingForCurrent || stoppingNow;
  if (waitingForCurrent) {
    els.stopBtn.textContent = '等待停止';
  } else if (stoppingNow) {
    els.stopBtn.textContent = '正在停止…';
  } else {
    els.stopBtn.textContent = '停止';
  }
}

function addUiLog(message, level = 'info') {
  const li = document.createElement('li');
  li.className = `log-${level}`;
  li.innerHTML = `<span class="log-tag">${levelLabel(level)}</span><span>${escapeHtml(message)}</span>`;
  els.log.prepend(li);
}

function levelLabel(level) {
  return ({
    start: '开始',
    auth: '登录',
    sign: '签名',
    api: '接口',
    search: '搜索',
    comment: '评论',
    import: '导入',
    download: '下载',
    stop: '停止',
    error: '错误',
    info: '信息'
  })[level] || '信息';
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function render(state) {
  const status = state.status || 'idle';
  const isBusy = status === 'running';
  if (isBusy && (state.mode === 'links' || state.mode === 'keyword') && state.mode !== currentMode) {
    switchMode(state.mode);
  }
  setBusy(isBusy);
  renderStopState(state, isBusy);
  document.body.classList.toggle('is-error', status === 'error');
  els.exportBtn.disabled = !(state.notes?.length || state.commentRows?.length);
  renderBadge(status);
  els.statusText.textContent = state.message || '等待输入关键词';
  els.noteCount.textContent = String(state.notes?.length || 0);
  els.commentCount.textContent = String(state.commentCount || 0);
  els.replyCount.textContent = String(state.replyCount || 0);
  els.progressBar.style.width = `${Math.max(0, Math.min(100, state.progress || 0))}%`;
  els.log.textContent = '';
  for (const item of (state.logs || []).slice(-3).reverse()) {
    const li = document.createElement('li');
    const entry = typeof item === 'string'
      ? { time: item.slice(0, 8), level: 'info', message: item.slice(9) || item }
      : item;
    li.className = `log-${entry.level || 'info'}`;
    li.innerHTML = `<span class="log-time">${escapeHtml(entry.time || '')}</span><span class="log-tag">${levelLabel(entry.level)}</span><span class="log-message">${escapeHtml(entry.message || '')}</span>`;
    els.log.appendChild(li);
  }
}

els.startBtn.addEventListener('click', async () => {
  if (currentMode === 'links') {
    const rawText = els.noteLinks.value.trim();
    if (!rawText) {
      els.noteLinks.focus();
      return;
    }
    syncDelayUi();
    await sendStart({
      type: 'START_LINK_COLLECT',
      rawText,
      delaySeconds: normalizedDelay()
    });
    return;
  }
  const keyword = els.keyword.value.trim();
  if (!keyword) {
    els.keyword.focus();
    return;
  }
  const limit = normalizedLimit();
  const delaySeconds = normalizedDelay();
  const sortType = normalizedSortType();
  const noteType = normalizedNoteType();
  const noteTime = normalizedNoteTime();
  syncLimitUi();
  syncSortUi();
  syncDelayUi();
  await sendStart({
    type: 'START_COLLECT',
    keyword,
    limit,
    sortType,
    noteType,
    noteTime,
    delaySeconds
  });
});

els.limit.addEventListener('input', syncLimitUi);
els.limit.addEventListener('change', syncLimitUi);
els.sortType.addEventListener('change', syncSortUi);
els.noteType.addEventListener('change', syncStartButton);
els.noteTime.addEventListener('change', syncStartButton);
els.delay.addEventListener('input', syncDelayUi);
els.delay.addEventListener('change', syncDelayUi);
els.keywordModeBtn.addEventListener('click', () => switchMode('keyword'));
els.linkModeBtn.addEventListener('click', () => switchMode('links'));
els.advancedFilters.addEventListener('toggle', () => {
  document.body.classList.toggle('filters-open', els.advancedFilters.open);
});

function closeStopDialog() {
  els.stopDialog.hidden = true;
}

els.stopBtn.addEventListener('click', () => {
  els.stopDialog.hidden = false;
  els.finishCurrentBtn.focus();
});
els.cancelStopBtn.addEventListener('click', closeStopDialog);
els.stopDialog.addEventListener('click', (event) => {
  if (event.target === els.stopDialog) {
    closeStopDialog();
  }
});
els.finishCurrentBtn.addEventListener('click', async () => {
  closeStopDialog();
  els.statusText.textContent = '已设置：采完当前笔记后停止';
  els.stopBtn.textContent = '等待停止';
  els.stopBtn.disabled = true;
  try {
    const result = await send({ type: 'STOP_AFTER_CURRENT' });
    if (!result?.ok) {
      throw new Error(result?.error || '设置停止失败');
    }
  } catch (error) {
    showStartError(error);
    els.stopBtn.textContent = '停止';
    els.stopBtn.disabled = false;
  }
});
els.immediateStopBtn.addEventListener('click', async () => {
  closeStopDialog();
  els.statusText.textContent = '正在立即停止…';
  els.stopBtn.textContent = '正在停止…';
  els.stopBtn.disabled = true;
  try {
    const result = await send({ type: 'STOP_COLLECT' });
    if (!result?.ok) {
      throw new Error(result?.error || '停止失败');
    }
  } catch (error) {
    showStartError(error);
    els.stopBtn.textContent = '停止';
    els.stopBtn.disabled = false;
  }
});
els.exportBtn.addEventListener('click', () => send({ type: 'EXPORT_DATA' }));

runtime?.onMessage?.addListener((message) => {
  if (message?.type === 'STATE_UPDATED') {
    render(message.state);
  }
});

async function refreshLoginStatus() {
  setLoginStatus('checking');
  try {
    const result = await send({ type: 'CHECK_LOGIN_STATUS' });
    setLoginStatus(result?.loggedIn ? 'logged-in' : 'logged-out');
  } catch (_) {
    setLoginStatus('logged-out');
  }
}

syncLimitUi();
syncSortUi();
syncDelayUi();
send({ type: 'GET_STATE' }).then(render).catch(() => {});
refreshLoginStatus();
