const els = {
  keyword: document.getElementById('keyword'),
  limit: document.getElementById('limit'),
  delay: document.getElementById('delay'),
  startBtn: document.getElementById('startBtn'),
  importBtn: document.getElementById('importBtn'),
  noteFile: document.getElementById('noteFile'),
  stopBtn: document.getElementById('stopBtn'),
  exportBtn: document.getElementById('exportBtn'),
  stateBadge: document.getElementById('stateBadge'),
  progressBar: document.getElementById('progressBar'),
  statusText: document.getElementById('statusText'),
  noteCount: document.getElementById('noteCount'),
  commentCount: document.getElementById('commentCount'),
  replyCount: document.getElementById('replyCount'),
  log: document.getElementById('log')
};

function normalizedLimit() {
  const value = Math.trunc(Number(els.limit.value || 10));
  return Math.max(1, Math.min(20, Number.isFinite(value) ? value : 10));
}

function normalizedDelay() {
  const value = Math.trunc(Number(els.delay.value || 6));
  return Math.max(3, Math.min(30, Number.isFinite(value) ? value : 6));
}

function syncLimitUi() {
  const limit = normalizedLimit();
  els.limit.value = String(limit);
  els.startBtn.textContent = `采集前${limit}条笔记`;
}

function syncDelayUi() {
  els.delay.value = String(normalizedDelay());
}

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function setBusy(isBusy) {
  els.startBtn.disabled = isBusy;
  els.importBtn.disabled = isBusy;
  els.stopBtn.disabled = !isBusy;
  els.stateBadge.classList.toggle('running', isBusy);
}

function decodeUtf8(bytes) {
  return new TextDecoder().decode(bytes);
}

function readUint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('当前浏览器不支持读取压缩版 xlsx，请选择插件直接导出的 notes_raw.xlsx');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipFile(buffer, filename) {
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  while (offset + 30 < bytes.length) {
    const signature = readUint32(bytes, offset);
    if (signature !== 0x04034b50) {
      break;
    }
    const method = readUint16(bytes, offset + 8);
    const compressedSize = readUint32(bytes, offset + 18);
    const fileSize = readUint32(bytes, offset + 22);
    const nameLength = readUint16(bytes, offset + 26);
    const extraLength = readUint16(bytes, offset + 28);
    const nameStart = offset + 30;
    const name = decodeUtf8(bytes.slice(nameStart, nameStart + nameLength));
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (name === filename) {
      const data = bytes.slice(dataStart, dataEnd);
      if (method === 0) {
        return decodeUtf8(data);
      }
      if (method === 8) {
        return decodeUtf8(await inflateRaw(data));
      }
      throw new Error('不支持的 xlsx 压缩格式');
    }
    offset = dataEnd;
  }
  throw new Error('没有找到 Excel 工作表');
}

async function tryUnzipFile(buffer, filename) {
  try {
    return await unzipFile(buffer, filename);
  } catch (_) {
    return '';
  }
}

function parseSharedStrings(xmlText) {
  if (!xmlText) {
    return [];
  }
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  return Array.from(doc.getElementsByTagName('si')).map((item) => (
    Array.from(item.getElementsByTagName('t')).map((node) => node.textContent || '').join('')
  ));
}

function cellColumn(ref) {
  const letters = String(ref || '').match(/[A-Z]+/i)?.[0] || '';
  let index = 0;
  for (const letter of letters.toUpperCase()) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return Math.max(0, index - 1);
}

function parseSheetRows(xmlText, sharedStrings = []) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  return Array.from(doc.getElementsByTagName('row')).map((row) => {
    const values = [];
    Array.from(row.getElementsByTagName('c')).forEach((cell) => {
      const column = cellColumn(cell.getAttribute('r'));
      const type = cell.getAttribute('t');
      const text = cell.getElementsByTagName('t')[0]?.textContent;
      const value = cell.getElementsByTagName('v')[0]?.textContent;
      values[column] = type === 's' ? (sharedStrings[Number(value)] || '') : (text ?? value ?? '');
    });
    return values.map((value) => String(value || '').trim());
  });
}

async function parseNotesWorkbook(buffer) {
  const sheetXml = await unzipFile(buffer, 'xl/worksheets/sheet1.xml');
  const sharedStrings = parseSharedStrings(await tryUnzipFile(buffer, 'xl/sharedStrings.xml'));
  const rows = parseSheetRows(sheetXml, sharedStrings);
  const headers = rows[0] || [];
  const indexOf = (name) => headers.indexOf(name);
  const linkIndex = indexOf('笔记链接');
  if (linkIndex < 0) {
    throw new Error('请选择 notes_raw.xlsx，必须包含“笔记链接”列');
  }
  const invalidRows = [];
  const notes = rows.slice(1).map((row, index) => ({
    batch: row[indexOf('采集批次')] || '',
    collectTime: row[indexOf('采集时间')] || '',
    keyword: row[indexOf('搜索关键词')] || '',
    rank: row[indexOf('关键词下排名')] || index + 1,
    link: row[linkIndex] || '',
    title: row[indexOf('笔记标题')] || '',
    author: row[indexOf('作者昵称')] || '',
    commentCount: row[indexOf('评论数')] || '',
    status: row[indexOf('采集状态')] || ''
  })).filter((note, index) => {
    if (!note.link) {
      return false;
    }
    try {
      const url = new URL(note.link);
      const noteId = url.pathname.split('/').filter(Boolean).pop();
      const token = url.searchParams.get('xsec_token');
      if (!noteId || !token) {
        invalidRows.push(index + 2);
        return false;
      }
      return true;
    } catch (_) {
      invalidRows.push(index + 2);
      return false;
    }
  });
  return {
    notes,
    totalRows: Math.max(0, rows.length - 1),
    invalidRows
  };
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
  setBusy(isBusy);
  els.exportBtn.disabled = !(state.notes?.length || state.commentRows?.length);
  els.stateBadge.textContent = isBusy ? '采集中' : status === 'error' ? '异常' : '就绪';
  const progress = state.taskProgress || {};
  const progressLabel = progress.total ? `${progress.label || `${progress.current}/${progress.total}`} · ` : '';
  els.statusText.textContent = `${progressLabel}${state.message || '等待输入关键词'}`;
  els.noteCount.textContent = String(state.notes?.length || 0);
  els.commentCount.textContent = String(state.commentCount || 0);
  els.replyCount.textContent = String(state.replyCount || 0);
  els.progressBar.style.width = `${Math.max(0, Math.min(100, state.progress || 0))}%`;
  els.log.textContent = '';
  for (const item of (state.logs || []).slice(-80).reverse()) {
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
  const keyword = els.keyword.value.trim();
  if (!keyword) {
    els.keyword.focus();
    return;
  }
  const limit = normalizedLimit();
  const delaySeconds = normalizedDelay();
  syncLimitUi();
  syncDelayUi();
  await send({
    type: 'START_COLLECT',
    keyword,
    limit,
    delaySeconds
  });
});

els.limit.addEventListener('input', syncLimitUi);
els.limit.addEventListener('change', syncLimitUi);
els.delay.addEventListener('input', syncDelayUi);
els.delay.addEventListener('change', syncDelayUi);

els.importBtn.addEventListener('click', () => {
  els.noteFile.value = '';
  els.noteFile.click();
});

els.noteFile.addEventListener('change', async () => {
  const file = els.noteFile.files?.[0];
  if (!file) {
    return;
  }
  try {
    addUiLog(`正在读取 Excel：${file.name}`, 'import');
    const buffer = await file.arrayBuffer();
    const result = await parseNotesWorkbook(buffer);
    const notes = result.notes;
    if (!notes.length) {
      throw new Error('Excel 里没有可采集的笔记链接，请确认链接包含 xsec_token');
    }
    const skippedText = result.invalidRows.length ? `，跳过无效行：${result.invalidRows.slice(0, 8).join('、')}` : '';
    addUiLog(`识别到 ${notes.length}/${result.totalRows} 条有效笔记${skippedText}`, 'import');
    await send({
      type: 'COLLECT_COMMENTS_FROM_NOTES',
      notes,
      delaySeconds: normalizedDelay()
    });
  } catch (error) {
    const text = String(error?.message || error);
    els.statusText.textContent = text;
    addUiLog(text, 'error');
  }
});

els.stopBtn.addEventListener('click', () => send({ type: 'STOP_COLLECT' }));
els.exportBtn.addEventListener('click', () => send({ type: 'EXPORT_DATA' }));

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'STATE_UPDATED') {
    render(message.state);
  }
});

syncLimitUi();
syncDelayUi();
send({ type: 'GET_STATE' }).then(render).catch(() => {});
