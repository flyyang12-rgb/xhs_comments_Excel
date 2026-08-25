const realGlobal = globalThis;
const extensionChrome = realGlobal.chrome;
importScripts('excel.js', 'search-config.js', 'note-links.js');
realGlobal.globalThis = realGlobal;
realGlobal.chrome = extensionChrome;

const activeControllers = new Set();
const pendingDelayCancels = new Set();

function trackedController(timeoutMs) {
  const controller = new AbortController();
  activeControllers.add(controller);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    controller,
    release() {
      clearTimeout(timer);
      activeControllers.delete(controller);
    }
  };
}

function abortActiveWork() {
  for (const controller of activeControllers) {
    controller.abort();
  }
  for (const cancel of pendingDelayCancels) {
    cancel();
  }
}

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
  const request = trackedController(2500);
  try {
    const response = await fetch('http://127.0.0.1:18765/sign', {
      method: 'POST',
      signal: request.controller.signal,
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
    if (state.stopRequested) {
      throw new Error('__STOPPED__');
    }
    const text = String(error?.message || error);
    if (text.includes('Failed to fetch') || text.includes('aborted') || text.includes('NetworkError')) {
      throw new Error('本机签名服务未启动：请先双击项目根目录的“启动小红书签名服务.bat”，保持黑色窗口打开后重试');
    }
    throw new Error(`本机签名服务失败：${text}`);
  } finally {
    request.release();
  }
}

const BASE_URL = 'https://edith.xiaohongshu.com';
const SEARCH_BASE_URL = 'https://so.xiaohongshu.com';
const SEARCH_NOTES_API = '/api/sns/web/v2/search/notes';
const NOTES_HEADERS = ['采集批次', '采集时间', '搜索关键词', '排序方式', '关键词下排名', '笔记链接', '笔记标题', '作者昵称', '评论数', '采集状态'];
const COMMENTS_HEADERS = ['笔记链接', '评论序号', '一级评论内容和图片链接', '所有二级评论内容和图片链接', '评论采集状态'];

const {
  SEARCH_SORT_OPTIONS,
  normalizeSearchSort,
  normalizeNoteType,
  normalizeNoteTime,
  createSearchId,
  buildSearchNotesPayload
} = realGlobal.XhsSearchConfig;
const { extractUrls, isShortLink, parseNoteUrl } = realGlobal.XhsNoteLinks;

const state = {
  status: 'idle',
  mode: 'keyword',
  message: '等待输入关键词',
  progress: 0,
  keyword: '',
  notes: [],
  commentRows: [],
  commentCount: 0,
  replyCount: 0,
  completedNotes: 0,
  targetNotes: 0,
  logs: [],
  stopRequested: false,
  stopAfterCurrent: false,
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
    mode: state.mode,
    message: state.message,
    progress: state.progress,
    keyword: state.keyword,
    notes: state.notes,
    commentRows: state.commentRows,
    commentCount: state.commentCount,
    replyCount: state.replyCount,
    completedNotes: state.completedNotes,
    targetNotes: state.targetNotes,
    stopRequested: state.stopRequested,
    stopAfterCurrent: state.stopAfterCurrent,
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
  return new Promise((resolve) => {
    let timer;
    const finish = () => {
      clearTimeout(timer);
      pendingDelayCancels.delete(finish);
      resolve();
    };
    timer = setTimeout(finish, base * 1000 + jitter);
    pendingDelayCancels.add(finish);
  });
}

function resultSummary(label, total, tail) {
  return `${label} · ${state.completedNotes}/${Math.max(0, Number(total || 0))}篇 · 评论${state.commentCount} · 回复${state.replyCount} · ${tail}`;
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

async function checkLoginStatus() {
  const hasA1Cookie = (cookies) => cookies.some((cookie) => cookie?.name === 'a1' && cookie.value);
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
  if (hasA1Cookie(cookieGroups.flat())) {
    return true;
  }

  const tabs = await chrome.tabs.query({ url: ['https://www.xiaohongshu.com/*', 'https://xiaohongshu.com/*'] }).catch(() => []);
  for (const tab of tabs) {
    if (!tab?.id) {
      continue;
    }
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.cookie || ''
    }).catch(() => []);
    if (String(result?.result || '').split(';').some((item) => item.trim().startsWith('a1='))) {
      return true;
    }
  }
  return false;
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
  const request = trackedController(30000);
  let response;
  try {
    response = await fetch(`${BASE_URL}${spliceApi}`, {
      method: 'GET',
      credentials: 'include',
      signal: request.controller.signal,
      headers: {
        accept: 'application/json, text/plain, */*',
        'x-b3-traceid': traceId(),
        'x-s': signed.xs,
        'x-s-common': signed.xs_common,
        'x-t': String(signed.xt)
      }
    });
  } catch (error) {
    if (state.stopRequested) {
      throw new Error('__STOPPED__');
    }
    throw error;
  } finally {
    request.release();
  }
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
  log(`请求接口 POST ${api}`, 'api');
  const request = trackedController(30000);
  const requestTraceId = traceId();
  const xrayTraceId = traceId();
  let response;
  try {
    response = await fetch(`${baseUrl}${api}`, {
      method: 'POST',
      credentials: 'include',
      signal: request.controller.signal,
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json;charset=UTF-8',
        'x-b3-traceid': requestTraceId,
        'x-xray-traceid': xrayTraceId,
        'x-s': signed.xs,
        'x-s-common': signed.xs_common,
        'x-t': String(signed.xt)
      },
      body: payload
    });
  } catch (error) {
    if (state.stopRequested) {
      throw new Error('__STOPPED__');
    }
    throw error;
  } finally {
    request.release();
  }
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

function parseNotes(searchData, keyword, limit, { rankOffset = 0, sortLabel = '' } = {}) {
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
      sortLabel,
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

async function resolveSharedNoteUrl(url) {
  if (!isShortLink(url)) {
    return url;
  }
  const request = trackedController(15000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit',
      signal: request.controller.signal
    });
    return response.url || url;
  } finally {
    request.release();
  }
}

async function resolveNoteLinks(rawText) {
  const urls = extractUrls(rawText);
  if (!urls.length) {
    throw new Error('没有识别到笔记链接，请粘贴小红书链接或分享文字');
  }
  if (urls.length > 1) {
    throw new Error('一次只能采集一个笔记链接');
  }
  const notes = [];
  const invalid = [];
  const seen = new Set();
  for (const sourceUrl of urls) {
    try {
      const resolvedUrl = await resolveSharedNoteUrl(sourceUrl);
      const parsed = parseNoteUrl(resolvedUrl);
      if (!parsed) {
        invalid.push(sourceUrl);
        continue;
      }
      if (!seen.has(parsed.noteId)) {
        seen.add(parsed.noteId);
        notes.push(parsed);
      }
    } catch (_) {
      invalid.push(sourceUrl);
    }
  }
  return { notes, invalid, total: urls.length };
}

async function getNoteDetail(input, login, rank) {
  const data = await signedPost('/api/sns/web/v1/feed', {
    source_note_id: input.noteId,
    image_formats: ['jpg', 'webp', 'avif'],
    extra: { need_body_topic: '1' },
    xsec_source: input.xsecSource || 'pc_feed',
    xsec_token: input.xsecToken || ''
  }, login);
  const item = data?.data?.items?.[0];
  const card = item?.note_card || {};
  if (!item || !Object.keys(card).length) {
    throw new Error('笔记详情接口未返回有效数据');
  }
  const noteId = item.id || card.note_id || input.noteId;
  const xsecToken = item.xsec_token || input.xsecToken || '';
  const params = new URLSearchParams();
  if (xsecToken) {
    params.set('xsec_token', xsecToken);
  }
  params.set('xsec_source', input.xsecSource || 'pc_feed');
  return {
    batch: batchId('笔记链接'),
    collectTime: formatDate(),
    keyword: '笔记链接',
    sortLabel: '指定链接',
    rank,
    link: `https://www.xiaohongshu.com/explore/${noteId}?${params.toString()}`,
    title: card.display_title || card.title || '无标题',
    author: card.user?.nick_name || card.user?.nickname || card.user?.name || '未知作者',
    commentCount: card.interact_info?.comment_count || '0',
    status: '成功',
    noteId,
    xsecToken
  };
}

async function searchNotesByApi({ keyword, limit, login, delaySeconds, sortType, noteType, noteTime }) {
  const targetLimit = Math.max(1, Math.min(20, Number(limit || 10)));
  const sortOption = normalizeSearchSort(sortType);
  const typeOption = normalizeNoteType(noteType);
  const timeOption = normalizeNoteTime(noteTime);
  const pageSize = 20;
  const searchId = createSearchId();
  const notesById = new Map();
  let page = 1;

  while (!state.stopRequested && notesById.size < targetLimit) {
    setTaskProgress('search', notesById.size, targetLimit, `搜索笔记 ${notesById.size}/${targetLimit}`);
    setState({
      message: `API 搜索${sortOption.label}笔记：${notesById.size}/${targetLimit}，第 ${page} 页`,
      progress: Math.min(18, 6 + page * 4)
    });
    log(`按${sortOption.label}搜索第 ${page} 页，已拿到 ${notesById.size}/${targetLimit} 条笔记`, 'search');
    throwIfStopped();

    const payload = buildSearchNotesPayload({
      keyword,
      page,
      pageSize,
      searchId,
      sessionId: crypto.randomUUID(),
      sortType: sortOption.sort,
      noteType: typeOption.value,
      noteTime: timeOption.value
    });
    const data = await signedPost(SEARCH_NOTES_API, payload, login, { baseUrl: SEARCH_BASE_URL });
    throwIfStopped();
    const parsedNotes = parseNotes(data, keyword, targetLimit, { rankOffset: notesById.size, sortLabel: sortOption.label });

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

function failedLinkedNote(input, rank, error) {
  return {
    batch: batchId('笔记链接'),
    collectTime: formatDate(),
    keyword: '笔记链接',
    sortLabel: '指定链接',
    rank,
    link: input.sourceUrl || `https://www.xiaohongshu.com/explore/${input.noteId}`,
    title: '',
    author: '',
    commentCount: '',
    status: `详情失败：${String(error?.message || error)}`,
    noteId: input.noteId,
    xsecToken: input.xsecToken || ''
  };
}

async function runLinkCollection({ rawText, delaySeconds }) {
  state.stopRequested = false;
  state.stopAfterCurrent = false;
  state.mode = 'links';
  setTaskProgress('resolve', 0, 0, '解析笔记链接');
  setState({
    status: 'running',
    keyword: '笔记链接',
    message: '正在解析笔记链接',
    progress: 2,
    notes: [],
    commentRows: [],
    commentCount: 0,
    replyCount: 0,
    completedNotes: 0,
    targetNotes: 0,
    logs: []
  });
  log('开始按指定笔记链接采集', 'start');

  const resolved = await resolveNoteLinks(rawText);
  throwIfStopped();
  if (!resolved.notes.length) {
    throw new Error('没有识别到有效的小红书笔记链接');
  }
  setState({ targetNotes: resolved.notes.length });
  log(`识别到 ${resolved.notes.length} 篇笔记${resolved.invalid.length ? `，跳过 ${resolved.invalid.length} 个无效链接` : ''}`, 'import');

  setTaskProgress('details', 0, resolved.notes.length, `读取详情 0/${resolved.notes.length}`);
  setState({ message: '检查小红书登录态', progress: 5 });
  const login = await getCookieString();
  throwIfStopped();
  log('登录态检查通过', 'auth');

  const notes = [];
  for (let i = 0; i < resolved.notes.length; i += 1) {
    throwIfStopped();
    const input = resolved.notes[i];
    setTaskProgress('details', i + 1, resolved.notes.length, `读取详情 ${i + 1}/${resolved.notes.length}`);
    setState({
      message: `读取笔记详情 ${i + 1}/${resolved.notes.length}`,
      progress: 5 + Math.round(((i + 1) / resolved.notes.length) * 20)
    });
    try {
      notes.push(await getNoteDetail(input, login, i + 1));
      log(`笔记详情 ${i + 1}/${resolved.notes.length} 读取成功`, 'api');
    } catch (error) {
      const text = String(error?.message || error);
      if (text === '__STOPPED__') {
        throw error;
      }
      if (text.includes('461') || text.includes('安全') || text.toLowerCase().includes('captcha')) {
        throw error;
      }
      notes.push(failedLinkedNote(input, i + 1, error));
      log(`笔记详情 ${i + 1} 读取失败：${text}`, 'error');
    }
    setState({ notes: [...notes] });
    if (i + 1 < resolved.notes.length && !state.stopRequested) {
      await randomDelay(delaySeconds ?? 6);
    }
  }

  throwIfStopped();
  await downloadBlob(createWorkbookBlob('notes_raw', noteRows()), 'notes_raw.xlsx');
  log('已下载 notes_raw.xlsx', 'download');

  const successfulNotes = notes.filter((note) => note.status === '成功');
  for (const note of notes.filter((item) => item.status !== '成功')) {
    state.commentRows.push([note.link, '', '', '', note.status]);
  }

  for (let i = 0; i < successfulNotes.length; i += 1) {
    if (state.stopRequested) {
      log('用户已停止采集', 'stop');
      break;
    }
    const note = successfulNotes[i];
    setTaskProgress('comments', i + 1, successfulNotes.length, `采集评论 ${i + 1}/${successfulNotes.length}`);
    setState({
      message: `采集评论 ${i + 1}/${successfulNotes.length}: ${note.title || note.noteId}`,
      progress: 25 + Math.round((i / Math.max(1, successfulNotes.length)) * 70)
    });
    log(`采集指定笔记 ${i + 1}/${successfulNotes.length}: ${note.title || note.noteId}`, 'comment');
    try {
      await collectCommentsForNote(note, login, delaySeconds ?? 6);
      state.completedNotes += 1;
    } catch (error) {
      const text = String(error?.message || error);
      if (text === '__STOPPED__') {
        throw error;
      }
      if (text.includes('461') || text.includes('安全') || text.toLowerCase().includes('captcha')) {
        throw error;
      }
      state.commentRows.push([note.link, '', '', '', `失败：${text}`]);
      log(`笔记 ${i + 1} 评论采集失败：${text}`, 'error');
    }
    if (state.stopAfterCurrent) {
      log('当前笔记已采完，按用户选择停止', 'stop');
      break;
    }
    if (i + 1 < successfulNotes.length && !state.stopRequested) {
      await randomDelay(delaySeconds ?? 6);
    }
  }

  const gracefulStop = state.stopAfterCurrent && !state.stopRequested;
  setTaskProgress('comments', state.completedNotes, state.targetNotes, state.stopRequested ? '已停止' : (gracefulStop ? '已停止' : '已完成'));
  setState({
    status: 'idle',
    message: state.stopRequested
      ? resultSummary('已停止', state.targetNotes, '可导出')
      : resultSummary(gracefulStop ? '已停止' : '已完成', state.targetNotes, '正在下载'),
    progress: state.stopRequested || gracefulStop ? state.progress : 100
  });
  if (!state.stopRequested) {
    await downloadBlob(createWorkbookBlob('comments_raw', commentRows()), 'comments_raw.xlsx');
    log('已下载 comments_raw.xlsx', 'download');
    setState({ message: resultSummary(gracefulStop ? '已停止' : '已完成', state.targetNotes, '已下载') });
  }
  state.stopAfterCurrent = false;
}

async function runCollection({ keyword, limit, delaySeconds, sortType, noteType, noteTime }) {
  state.stopRequested = false;
  state.stopAfterCurrent = false;
  state.mode = 'keyword';
  const targetLimit = Math.max(1, Math.min(20, Number(limit || 10)));
  const sortOption = normalizeSearchSort(sortType);
  const typeOption = normalizeNoteType(noteType);
  const timeOption = normalizeNoteTime(noteTime);
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
    completedNotes: 0,
    targetNotes: targetLimit,
    logs: []
  });
  log(`开始关键词采集：${keyword}，排序：${sortOption.label}，类型：${typeOption.label}，时间：${timeOption.label}`, 'start');

  const login = await getCookieString();
  throwIfStopped();
  log('登录态检查通过', 'auth');

  const notes = await searchNotesByApi({
    keyword,
    limit,
    login,
    delaySeconds,
    sortType: sortOption.sort,
    noteType: typeOption.value,
    noteTime: timeOption.value
  });
  throwIfStopped();
  if (!notes.length) {
    throw new Error(`${sortOption.label}搜索接口未返回可采集的笔记`);
  }
  setState({ notes, message: `已通过 API 获取 ${notes.length} 条${sortOption.label}笔记`, progress: 20 });
  log(`${sortOption.label}搜索完成，获取笔记 ${notes.length} 条`, 'search');

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
    state.completedNotes += 1;
    if (state.stopAfterCurrent) {
      log('当前笔记已采完，按用户选择停止', 'stop');
      break;
    }
    if (!state.stopRequested) {
      await randomDelay(delaySeconds ?? 6);
    }
  }
  state.targetNotes = notes.length;

  const gracefulStop = state.stopAfterCurrent && !state.stopRequested;
  setTaskProgress('comments', state.completedNotes, state.targetNotes, state.stopRequested ? '已停止' : (gracefulStop ? '已停止' : '已完成'));
  setState({
    status: 'idle',
    message: state.stopRequested
      ? resultSummary('已停止', state.targetNotes, '可导出')
      : resultSummary(gracefulStop ? '已停止' : '已完成', state.targetNotes, '正在下载'),
    progress: state.stopRequested || gracefulStop ? state.progress : 100
  });
  if (!state.stopRequested) {
    await downloadBlob(createWorkbookBlob('comments_raw', commentRows()), 'comments_raw.xlsx');
    log('已下载 comments_raw.xlsx', 'download');
    setState({ message: resultSummary(gracefulStop ? '已停止' : '已完成', state.targetNotes, '已下载') });
  }
  state.stopAfterCurrent = false;
}

function noteRows() {
  return [
    NOTES_HEADERS,
    ...state.notes.map((note) => [
      note.batch,
      note.collectTime,
      note.keyword,
      note.sortLabel || '',
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
    if (message?.type === 'CHECK_LOGIN_STATUS') {
      sendResponse({ ok: true, loggedIn: await checkLoginStatus() });
      return;
    }
    if (message?.type === 'STOP_COLLECT') {
      state.stopRequested = true;
      state.stopAfterCurrent = false;
      abortActiveWork();
      setTaskProgress(state.taskProgress.phase, state.taskProgress.current, state.taskProgress.total, '正在立即停止');
      setState({
        status: 'running',
        message: '正在立即停止'
      });
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'STOP_AFTER_CURRENT') {
      if (state.status !== 'running') {
        sendResponse({ ok: false, error: '当前没有正在进行的采集' });
        return;
      }
      state.stopAfterCurrent = true;
      setState({ message: '将在当前笔记采完后停止' });
      log('已选择：采完当前笔记后停止', 'stop');
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
            message: resultSummary('已停止', state.targetNotes || state.taskProgress.total, '可导出')
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
    if (message?.type === 'START_LINK_COLLECT') {
      if (state.status === 'running') {
        sendResponse({ ok: false, error: '采集正在进行中' });
        return;
      }
      runLinkCollection(message).catch((error) => {
        const text = String(error?.message || error);
        if (text === '__STOPPED__') {
          setTaskProgress(state.taskProgress.phase, state.taskProgress.current, state.taskProgress.total, '已停止');
          setState({ status: 'idle', message: resultSummary('已停止', state.targetNotes || state.taskProgress.total, '可导出') });
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
  })().catch((error) => {
    sendResponse({ ok: false, error: String(error?.message || error) });
  });
  return true;
});
