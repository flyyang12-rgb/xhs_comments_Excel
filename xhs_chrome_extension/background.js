const realGlobal = globalThis;
const extensionChrome = realGlobal.chrome;
importScripts('excel.js');
realGlobal.globalThis = realGlobal;
realGlobal.chrome = extensionChrome;

async function ensureSignerOffscreen() {
  const offscreenUrl = chrome.runtime.getURL('signer-offscreen.html');
  if (chrome.offscreen?.hasDocument && await chrome.offscreen.hasDocument()) {
    return;
  }
  const clientsList = await clients.matchAll();
  if (clientsList.some((client) => client.url === offscreenUrl)) {
    return;
  }
  await chrome.offscreen.createDocument({
    url: 'signer-offscreen.html',
    reasons: ['DOM_SCRAPING'],
    justification: 'Run the Xiaohongshu request signer in a hidden extension document.'
  });
  log('隐藏签名页已创建', 'sign');
}

async function signRequest(api, data, a1, method = 'GET') {
  return signRequestWithLocalHelper(api, data, a1, method);
}

async function signRequestWithLocalHelper(api, data, a1, method = 'GET') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch('http://127.0.0.1:18765/sign', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json;charset=UTF-8'
      },
      body: JSON.stringify({
        api,
        data: data || '',
        a1,
        method
      })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
      throw new Error(result?.error || `HTTP ${response.status}`);
    }
    log(`签名完成 ${method} ${api}`, 'sign');
    return result.signed;
  } catch (error) {
    const text = String(error?.message || error);
    if (text.includes('Failed to fetch') || text.includes('aborted') || text.includes('NetworkError')) {
      throw new Error('本机签名服务未启动：请先双击项目根目录的“启动小红书签名服务.bat”，保持黑色窗口打开后重试');
    }
    throw new Error(`本机签名服务失败：${text}`);
  } finally {
    clearTimeout(timer);
  }
}

const BASE_URL = 'https://edith.xiaohongshu.com';
const SEARCH_BASE_URL = 'https://so.xiaohongshu.com';
const SEARCH_NOTES_API = '/api/sns/web/v2/search/notes';
const NOTES_HEADERS = ['采集批次', '采集时间', '搜索关键词', '关键词下排名', '笔记链接', '笔记标题', '作者昵称', '评论数', '采集状态'];
const COMMENTS_HEADERS = ['笔记链接', '评论序号', '一级评论内容和图片链接', '所有二级评论内容和图片链接', '评论采集状态'];

const state = {
  status: 'idle',
  message: '等待输入关键词',
  progress: 0,
  keyword: '',
  notes: [],
  commentRows: [],
  commentCount: 0,
  replyCount: 0,
  logs: [],
  stopRequested: false,
  taskProgress: {
    phase: 'idle',
    current: 0,
    total: 0,
    label: ''
  }
};

function log(message, level = 'info') {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  state.logs.push({
    time,
    level,
    message: String(message || '')
  });
  if (state.logs.length > 200) {
    state.logs.splice(0, state.logs.length - 200);
  }
  broadcast();
}

function setState(patch) {
  Object.assign(state, patch);
  broadcast();
}

function publicState() {
  return {
    status: state.status,
    message: state.message,
    progress: state.progress,
    keyword: state.keyword,
    notes: state.notes,
    commentRows: state.commentRows,
    commentCount: state.commentCount,
    replyCount: state.replyCount,
    logs: state.logs,
    taskProgress: state.taskProgress
  };
}

function setTaskProgress(phase, current, total, label = '') {
  state.taskProgress = {
    phase,
    current: Math.max(0, Number(current || 0)),
    total: Math.max(0, Number(total || 0)),
    label
  };
}

function broadcast() {
  chrome.runtime.sendMessage({ type: 'STATE_UPDATED', state: publicState() }).catch(() => {});
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function randomDelay(seconds) {
  if (state.stopRequested) {
    return Promise.resolve();
  }
  const base = Math.max(3, Number(seconds ?? 6));
  const jitter = Math.floor(Math.random() * 2500);
  return sleep(base * 1000 + jitter);
}

function throwIfStopped() {
  if (state.stopRequested) {
    throw new Error('__STOPPED__');
  }
}

function formatDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function batchId(keyword) {
  const date = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${keyword}_01`;
}

async function getCookieString() {
  const parseCookieText = (cookieText) => {
    const parts = [];
    let a1 = '';
    const seen = new Set();
    for (const item of String(cookieText || '').split(';')) {
      const part = item.trim();
      if (!part || !part.includes('=')) {
        continue;
      }
      const [name, ...rest] = part.split('=');
      const key = name.trim();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      const value = rest.join('=').trim();
      if (key === 'a1') {
        a1 = value;
      }
      parts.push(`${key}=${value}`);
    }
    return { cookie: parts.join('; '), a1 };
  };

  const readCookies = async () => {
    const stores = await chrome.cookies.getAllCookieStores().catch(() => [{ id: undefined }]);
    const queries = [
      { url: 'https://www.xiaohongshu.com/' },
      { url: 'https://xiaohongshu.com/' },
      { url: 'https://edith.xiaohongshu.com/' },
      { url: 'https://so.xiaohongshu.com/' },
      { domain: 'xiaohongshu.com' },
      { domain: '.xiaohongshu.com' },
      { domain: 'www.xiaohongshu.com' },
      { domain: '.www.xiaohongshu.com' },
      { domain: 'edith.xiaohongshu.com' },
      { domain: '.edith.xiaohongshu.com' },
      { domain: 'so.xiaohongshu.com' },
      { domain: '.so.xiaohongshu.com' }
    ];
    const cookieGroups = await Promise.all(
      stores.flatMap((store) => queries.map((query) => (
        chrome.cookies.getAll({
          ...query,
          ...(store.id ? { storeId: store.id } : {})
        }).catch(() => [])
      )))
    );

    const seen = new Set();
    const parts = [];
    let a1 = '';
    for (const cookie of cookieGroups.flat()) {
      if (!cookie.name || seen.has(cookie.name)) {
        continue;
      }
      seen.add(cookie.name);
      if (cookie.name === 'a1') {
        a1 = cookie.value;
      }
      parts.push(`${cookie.name}=${cookie.value}`);
    }
    return { cookie: parts.join('; '), a1 };
  };

  const readCookiesFromPage = async () => {
    const tabs = await chrome.tabs.query({ url: 'https://www.xiaohongshu.com/*' }).catch(() => []);
    const tab = tabs.find((item) => item.id);
    if (!tab?.id) {
      return { cookie: '', a1: '' };
    }
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.cookie || ''
    }).catch(() => []);
    return parseCookieText(result?.result || '');
  };

  const warmUpCookies = async () => {
    await fetch('https://www.xiaohongshu.com/', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }).catch(() => null);
    await sleep(500);
  };

  let result = await readCookies();
  if (!result.a1) {
    log('未读到 a1，正在刷新浏览器 Cookie', 'auth');
    await warmUpCookies();
    result = await readCookies();
  }
  if (!result.a1) {
    log('后台未读到 a1，尝试从已登录页面读取 Cookie', 'auth');
    const pageResult = await readCookiesFromPage();
    if (pageResult.a1) {
      result = pageResult;
    }
  }
  if (!result.a1) {
    throw new Error('已看到小红书页面但未读到 a1，请刷新小红书页面后重试，或在 chrome://extensions/ 确认插件允许访问小红书站点');
  }
  return result;
}

function traceId() {
  const chars = 'abcdef0123456789';
  let out = '';
  for (let i = 0; i < 16; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function signedGet(api, params, login) {
  const query = new URLSearchParams(params).toString();
  const spliceApi = `${api}?${query}`;
  const signed = await signRequest(spliceApi, '', login.a1, 'GET');
  log(`请求评论接口 GET ${api}`, 'api');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const response = await fetch(`${BASE_URL}${spliceApi}`, {
    method: 'GET',
    credentials: 'include',
    signal: controller.signal,
    headers: {
      accept: 'application/json, text/plain, */*',
      'x-b3-traceid': traceId(),
      'x-s': signed.xs,
      'x-s-common': signed.xs_common,
      'x-t': String(signed.xt)
    }
  }).finally(() => clearTimeout(timer));
  if (!response.ok) {
    if (response.status === 461) {
      throw new Error('接口 HTTP 461：触发小红书安全限制，请停止采集，等待一段时间后把请求间隔调大再试');
    }
    throw new Error(`接口 HTTP ${response.status}`);
  }
  const data = await response.json();
  if (!data?.success) {
    throw new Error(data?.msg || '接口返回失败');
  }
  return data;
}

async function signedPost(api, body, login, { baseUrl = BASE_URL } = {}) {
  const payload = JSON.stringify(body || {});
  const signed = await signRequest(api, payload, login.a1, 'POST');
  log(`请求搜索接口 POST ${api}`, 'api');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const response = await fetch(`${baseUrl}${api}`, {
    method: 'POST',
    credentials: 'include',
    signal: controller.signal,
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json;charset=UTF-8',
      'x-b3-traceid': traceId(),
      'x-s': signed.xs,
      'x-s-common': signed.xs_common,
      'x-t': String(signed.xt)
    },
    body: payload
  }).finally(() => clearTimeout(timer));
  if (!response.ok) {
    if (response.status === 461) {
      throw new Error('接口 HTTP 461：触发小红书安全限制，请停止采集，等待一段时间后把请求间隔调大再试');
    }
    throw new Error(`接口 HTTP ${response.status}`);
  }
  const data = await response.json();
  if (!data?.success) {
    throw new Error(data?.msg || '接口返回失败');
  }
  return data;
}

function randomToken(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function createSearchId() {
  return `${randomToken(20)}@${randomToken(20)}`;
}

function buildSearchNotesPayload({ keyword, page, pageSize, searchId }) {
  return {
    keyword,
    page,
    page_size: pageSize,
    search_id: searchId,
    sort: 'general',
    note_type: 0,
    ext_flags: [],
    filters: [
      {
        tags: ['comment_descending'],
        type: 'sort_type'
      },
      {
        tags: ['不限'],
        type: 'filter_note_type'
      },
      {
        tags: ['不限'],
        type: 'filter_note_time'
      },
      {
        tags: ['不限'],
        type: 'filter_note_range'
      },
      {
        tags: ['不限'],
        type: 'filter_pos_distance'
      }
    ],
    geo: '',
    image_formats: ['jpg', 'webp', 'avif'],
    message_id: ''
  };
}

function parseNotes(searchData, keyword, limit, { rankOffset = 0 } = {}) {
  const items = searchData?.data?.items || [];
  const rows = [];
  const now = formatDate();
  const batch = batchId(keyword);
  let rank = rankOffset;
  for (const item of items) {
    if (item?.model_type !== 'note') {
      continue;
    }
    const note = item.note_card || {};
    const noteId = item.id;
    const xsecToken = item.xsec_token;
    if (!noteId || !xsecToken) {
      continue;
    }
    rank += 1;
    if (rank > limit) {
      break;
    }
    const link = `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${encodeURIComponent(xsecToken)}`;
    rows.push({
      batch,
      collectTime: now,
      keyword,
      rank,
      link,
      title: note.display_title || '无标题',
      author: note.user?.nick_name || '未知作者',
      commentCount: note.interact_info?.comment_count || '0',
      status: '成功',
      noteId,
      xsecToken
    });
  }
  return rows;
}

async function searchNotesByApi({ keyword, limit, login, delaySeconds }) {
  const targetLimit = Math.max(1, Math.min(20, Number(limit || 10)));
  const pageSize = 20;
  const searchId = createSearchId();
  const notesById = new Map();
  let page = 1;

  while (!state.stopRequested && notesById.size < targetLimit) {
    setTaskProgress('search', notesById.size, targetLimit, `搜索笔记 ${notesById.size}/${targetLimit}`);
    setState({
      message: `API 搜索最多评论笔记：${notesById.size}/${targetLimit}，第 ${page} 页`,
      progress: Math.min(18, 6 + page * 4)
    });
    log(`搜索第 ${page} 页，已拿到 ${notesById.size}/${targetLimit} 条笔记`, 'search');
    throwIfStopped();

    const payload = buildSearchNotesPayload({
      keyword,
      page,
      pageSize,
      searchId
    });
    const data = await signedPost(SEARCH_NOTES_API, payload, login, { baseUrl: SEARCH_BASE_URL });
    throwIfStopped();
    const parsedNotes = parseNotes(data, keyword, targetLimit, { rankOffset: notesById.size });

    for (const note of parsedNotes) {
      if (!notesById.has(note.noteId)) {
        notesById.set(note.noteId, note);
      }
      if (notesById.size >= targetLimit) {
        break;
      }
    }

    const notes = Array.from(notesById.values()).slice(0, targetLimit);
    setTaskProgress('search', notes.length, targetLimit, `搜索笔记 ${notes.length}/${targetLimit}`);
    setState({
      notes,
      message: `已解析笔记 ${notes.length}/${targetLimit} 条`,
      progress: Math.max(state.progress, 18)
    });

    const items = data?.data?.items || [];
    if (!data?.data?.has_more || items.length === 0 || parsedNotes.length === 0) {
      break;
    }

    page += 1;
    if (!state.stopRequested) {
      await randomDelay(delaySeconds ?? 6);
    }
  }

  return Array.from(notesById.values()).slice(0, targetLimit);
}

async function getRootComments(note, login, delaySeconds) {
  let cursor = '';
  const comments = [];
  let page = 1;
  while (!state.stopRequested) {
    setState({
      message: `笔记 ${note.rank}: 请求一级评论第 ${page} 页，已获取 ${comments.length} 条`
    });
    const data = await signedGet('/api/sns/web/v2/comment/page', {
      note_id: note.noteId,
      cursor,
      top_comment_id: '',
      image_formats: 'jpg,webp,avif',
      xsec_token: note.xsecToken
    }, login);
    const pageComments = data?.data?.comments || [];
    comments.push(...pageComments);
    setState({
      message: `笔记 ${note.rank}: 已获取一级评论 ${comments.length} 条`,
      commentCount: state.commentCount + pageComments.length
    });
    if (!data?.data?.has_more || pageComments.length === 0) {
      break;
    }
    cursor = String(data.data.cursor || '');
    page += 1;
    if (!state.stopRequested) {
      await randomDelay(delaySeconds ?? 6);
    }
  }
  return comments;
}

async function getSubComments(comment, xsecToken, login, delaySeconds) {
  const subComments = [...(comment.sub_comments || [])];
  const seen = new Set(subComments.map((item) => item?.id).filter(Boolean));
  if (!comment.sub_comment_has_more || state.stopRequested) {
    return subComments;
  }

  let cursor = comment.sub_comment_cursor || '';
  let page = 1;
  while (!state.stopRequested) {
    setState({
      message: `请求二级评论第 ${page} 页，已获取 ${subComments.length} 条`
    });
    const data = await signedGet('/api/sns/web/v2/comment/sub/page', {
      note_id: comment.note_id || '',
      root_comment_id: comment.id || '',
      num: '10',
      cursor,
      image_formats: 'jpg,webp,avif',
      top_comment_id: '',
      xsec_token: xsecToken
    }, login);
    const pageComments = data?.data?.comments || [];
    for (const subComment of pageComments) {
      if (subComment?.id && seen.has(subComment.id)) {
        continue;
      }
      if (subComment?.id) {
        seen.add(subComment.id);
      }
      subComments.push(subComment);
    }
    setState({
      message: `处理中二级评论：${subComments.length} 条`,
      replyCount: state.replyCount + pageComments.length
    });
    if (!data?.data?.has_more || pageComments.length === 0) {
      break;
    }
    cursor = String(data.data.cursor || '');
    page += 1;
    if (!state.stopRequested) {
      await randomDelay(delaySeconds ?? 6);
    }
  }
  return subComments;
}

function extractPictureLinks(comment) {
  const links = [];
  for (const picture of comment?.pictures || []) {
    let url = picture?.url_default || picture?.url_pre || '';
    if (!url) {
      const found = (picture?.info_list || []).find((item) => item?.url);
      url = found?.url || '';
    }
    if (url) {
      links.push(url);
    }
  }
  return links.join('\n');
}

function singleCommentField(comment) {
  const lines = [];
  const content = String(comment?.content || '').trim();
  const pictures = extractPictureLinks(comment);
  if (content) {
    lines.push(content);
  }
  if (pictures) {
    lines.push(pictures);
  }
  return lines.join('\n');
}

function repliesField(comment) {
  return (comment.sub_comments || [])
    .map((subComment, index) => {
      const field = singleCommentField(subComment);
      return field ? `回复${index + 1}: ${field}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

async function collectCommentsForNote(note, login, delaySeconds) {
  const comments = await getRootComments(note, login, delaySeconds);
  if (!comments.length) {
    state.commentRows.push([note.link, '', '', '', '无评论']);
    return;
  }

  for (let index = 0; index < comments.length; index += 1) {
    if (state.stopRequested) {
      break;
    }
    const comment = comments[index];
    comment.sub_comments = await getSubComments(comment, note.xsecToken, login, delaySeconds);
    state.commentRows.push([
      note.link,
      index + 1,
      singleCommentField(comment),
      repliesField(comment),
      comment?.id && comment?.content !== undefined ? '成功' : '失败'
    ]);
    if ((index + 1) % 10 === 0 || index + 1 === comments.length) {
      log(`笔记 ${note.rank} 已处理 ${index + 1}/${comments.length} 条一级评论`, 'comment');
    }
  }
}

function normalizeImportedNotes(notes) {
  return (notes || []).map((note, index) => {
    const link = String(note.link || '').trim();
    let noteId = note.noteId || '';
    let xsecToken = note.xsecToken || '';
    try {
      const url = new URL(link);
      const parts = url.pathname.split('/').filter(Boolean);
      noteId = noteId || parts[parts.length - 1] || '';
      xsecToken = xsecToken || url.searchParams.get('xsec_token') || '';
    } catch (_) {}
    return {
      batch: note.batch || '',
      collectTime: note.collectTime || '',
      keyword: note.keyword || '',
      rank: Number(note.rank || index + 1),
      link,
      title: note.title || '',
      author: note.author || '',
      commentCount: note.commentCount || '',
      status: note.status || '导入',
      noteId,
      xsecToken
    };
  }).filter((note) => note.link && note.noteId && note.xsecToken);
}

async function runCommentCollectionFromNotes({ notes, delaySeconds }) {
  const importedNotes = normalizeImportedNotes(notes);
  if (!importedNotes.length) {
    throw new Error('导入文件里没有可采集的笔记链接');
  }

  state.stopRequested = false;
  setTaskProgress('comments', 0, importedNotes.length, `采集评论 0/${importedNotes.length}`);
  setState({
    status: 'running',
    message: '检查小红书登录态',
    progress: 3,
    notes: importedNotes,
    commentRows: [],
    commentCount: 0,
    replyCount: 0,
    logs: []
  });
  log(`导入 ${importedNotes.length} 条笔记，开始采评论`, 'import');

  const login = await getCookieString();
  throwIfStopped();
  log('登录态检查通过', 'auth');

  for (let i = 0; i < importedNotes.length; i += 1) {
    if (state.stopRequested) {
      log('用户已停止采集', 'stop');
      break;
    }
    const note = importedNotes[i];
    setTaskProgress('comments', i + 1, importedNotes.length, `采集评论 ${i + 1}/${importedNotes.length}`);
    setState({
      message: `采集评论 ${i + 1}/${importedNotes.length}: ${note.title || note.noteId}`,
      progress: 5 + Math.round((i / importedNotes.length) * 90)
    });
    log(`采集导入笔记 ${i + 1}/${importedNotes.length}: ${note.title || note.noteId}`, 'comment');
    try {
      await collectCommentsForNote(note, login, delaySeconds ?? 6);
    } catch (error) {
      const text = String(error?.message || error);
      state.commentRows.push([note.link, '', '', '', `失败：${text}`]);
      log(`笔记 ${i + 1} 评论采集失败：${text}`, 'error');
    }
    if (!state.stopRequested) {
      await randomDelay(delaySeconds ?? 6);
    }
  }

  setTaskProgress('comments', state.stopRequested ? state.taskProgress.current : importedNotes.length, importedNotes.length, state.stopRequested ? '已停止' : `采集评论 ${importedNotes.length}/${importedNotes.length}`);
  setState({
    status: 'idle',
    message: state.stopRequested ? '已停止，可导出已采集评论' : '评论采集完成，正在下载 Excel',
    progress: state.stopRequested ? state.progress : 100
  });
  if (!state.stopRequested) {
    await downloadBlob(createWorkbookBlob('comments_raw', commentRows()), 'comments_raw.xlsx');
    log('已下载 comments_raw.xlsx', 'download');
    setState({ message: '评论采集完成，Excel 已下载' });
  }
}

async function runCollection({ keyword, limit, delaySeconds }) {
  state.stopRequested = false;
  const targetLimit = Math.max(1, Math.min(20, Number(limit || 10)));
  setTaskProgress('search', 0, targetLimit, `搜索笔记 0/${targetLimit}`);
  setState({
    status: 'running',
    keyword,
    message: '检查小红书登录态',
    progress: 2,
    notes: [],
    commentRows: [],
    commentCount: 0,
    replyCount: 0,
    logs: []
  });
  log(`开始关键词采集：${keyword}`, 'start');

  const login = await getCookieString();
  throwIfStopped();
  log('登录态检查通过', 'auth');

  const notes = await searchNotesByApi({ keyword, limit, login, delaySeconds });
  throwIfStopped();
  if (!notes.length) {
    throw new Error('最多评论搜索接口未返回可采集的笔记');
  }
  setState({ notes, message: `已通过 API 获取 ${notes.length} 条笔记`, progress: 20 });
  log(`搜索完成，获取笔记 ${notes.length} 条`, 'search');

  await downloadBlob(createWorkbookBlob('notes_raw', noteRows()), 'notes_raw.xlsx');
  log('已下载 notes_raw.xlsx', 'download');

  for (let i = 0; i < notes.length; i += 1) {
    if (state.stopRequested) {
      log('用户已停止采集', 'stop');
      break;
    }
    const note = notes[i];
    setTaskProgress('comments', i + 1, notes.length, `采集评论 ${i + 1}/${notes.length}`);
    setState({
      message: `采集评论 ${i + 1}/${notes.length}: ${note.title}`,
      progress: 20 + Math.round((i / notes.length) * 75)
    });
    log(`采集笔记 ${i + 1}/${notes.length}: ${note.title || note.noteId}`, 'comment');
    await collectCommentsForNote(note, login, delaySeconds ?? 6);
    if (!state.stopRequested) {
      await randomDelay(delaySeconds ?? 6);
    }
  }

  setTaskProgress('comments', state.stopRequested ? state.taskProgress.current : notes.length, notes.length, state.stopRequested ? '已停止' : `采集评论 ${notes.length}/${notes.length}`);
  setState({
    status: state.stopRequested ? 'idle' : 'idle',
    message: state.stopRequested ? '已停止，可导出已采集数据' : '采集完成，正在下载 Excel',
    progress: state.stopRequested ? state.progress : 100
  });
  if (!state.stopRequested) {
    await downloadBlob(createWorkbookBlob('comments_raw', commentRows()), 'comments_raw.xlsx');
    log('已下载 comments_raw.xlsx', 'download');
    setState({ message: '采集完成，Excel 已下载' });
  }
}

function noteRows() {
  return [
    NOTES_HEADERS,
    ...state.notes.map((note) => [
      note.batch,
      note.collectTime,
      note.keyword,
      note.rank,
      note.link,
      note.title,
      note.author,
      note.commentCount,
      note.status
    ])
  ];
}

function commentRows() {
  return [COMMENTS_HEADERS, ...state.commentRows];
}

function downloadBlob(blob, filename) {
  return blob.arrayBuffer().then(async (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const url = `data:${blob.type};base64,${btoa(binary)}`;
    await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
  });
}

async function exportData() {
  if (!state.notes.length && !state.commentRows.length) {
    throw new Error('当前没有可导出的数据');
  }
  await downloadBlob(createWorkbookBlob('notes_raw', noteRows()), 'notes_raw.xlsx');
  await downloadBlob(createWorkbookBlob('comments_raw', commentRows()), 'comments_raw.xlsx');
  log('已触发 Excel 下载', 'download');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'SIGN_XHS_REQUEST') {
    return false;
  }
  (async () => {
    if (message?.type === 'GET_STATE') {
      sendResponse(publicState());
      return;
    }
    if (message?.type === 'STOP_COLLECT') {
      state.stopRequested = true;
      setTaskProgress(state.taskProgress.phase, state.taskProgress.current, state.taskProgress.total, '正在停止');
      setState({
        status: 'idle',
        message: '正在停止，当前请求完成后退出，可先导出已采集数据'
      });
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'EXPORT_DATA') {
      await exportData();
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'START_COLLECT') {
      if (state.status === 'running') {
        sendResponse({ ok: false, error: '采集正在进行中' });
        return;
      }
      runCollection(message).catch((error) => {
        const text = String(error?.message || error);
        if (text === '__STOPPED__') {
          setTaskProgress(state.taskProgress.phase, state.taskProgress.current, state.taskProgress.total, '已停止');
          setState({
            status: 'idle',
            message: '已停止，可导出已采集数据'
          });
          log('用户已停止采集', 'stop');
          return;
        }
        const stoppedByRisk = text.includes('461') || text.includes('安全') || text.toLowerCase().includes('captcha');
        setState({
          status: 'error',
          message: stoppedByRisk ? `检测到安全限制：${text}` : text
        });
        log(`失败：${text}`, 'error');
      });
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'COLLECT_COMMENTS_FROM_NOTES') {
      if (state.status === 'running') {
        sendResponse({ ok: false, error: '采集正在进行中' });
        return;
      }
      runCommentCollectionFromNotes(message).catch((error) => {
        const text = String(error?.message || error);
        if (text === '__STOPPED__') {
          setTaskProgress(state.taskProgress.phase, state.taskProgress.current, state.taskProgress.total, '已停止');
          setState({
            status: 'idle',
            message: '已停止，可导出已采集评论'
          });
          log('用户已停止采集', 'stop');
          return;
        }
        const stoppedByRisk = text.includes('461') || text.includes('安全') || text.toLowerCase().includes('captcha');
        setState({
          status: 'error',
          message: stoppedByRisk ? `检测到安全限制：${text}` : text
        });
        log(`失败：${text}`, 'error');
      });
      sendResponse({ ok: true });
    }
  })().catch((error) => {
    sendResponse({ ok: false, error: String(error?.message || error) });
  });
  return true;
});
