const http = require('http');

const originalLog = console.log;
console.log = () => {};
const signer = require('./xhs_main_260411.js');
console.log = originalLog;

const HOST = '127.0.0.1';
const PORT = Number(process.env.XHS_SIGN_PORT || 18765);
const MAX_BODY_BYTES = 1024 * 1024;

function sendJson(res, statusCode, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json;charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type'
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true, signer: 'xhs_main_260411', port: PORT });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/sign') {
    sendJson(res, 404, { ok: false, error: 'not_found' });
    return;
  }

  try {
    const body = await readBody(req);
    const payload = JSON.parse((body || '{}').replace(/^\uFEFF/, ''));
    if (!payload.api || !payload.a1) {
      throw new Error('缺少 api 或 a1');
    }

    const mutedLog = console.log;
    console.log = () => {};
    const signed = signer.get_request_headers_params(
      payload.api,
      payload.data || '',
      payload.a1,
      payload.method || 'GET'
    );
    console.log = mutedLog;

    sendJson(res, 200, { ok: true, signed });
  } catch (error) {
    console.log = originalLog;
    sendJson(res, 500, { ok: false, error: String(error?.message || error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`小红书签名服务已启动：http://${HOST}:${PORT}`);
  console.log('保持这个窗口打开，然后回到 Chrome 插件点击开始采集。');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。可能签名服务已经在运行，可以直接回到 Chrome 插件开始采集。`);
    return;
  }
  console.error(error && error.stack ? error.stack : String(error));
});
