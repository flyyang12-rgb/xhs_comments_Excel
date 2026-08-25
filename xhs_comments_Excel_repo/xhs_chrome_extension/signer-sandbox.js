function reportError(error) {
  window.parent.postMessage({
    type: 'XHS_SIGNER_ERROR',
    error: String(error?.message || error)
  }, '*');
}

const nativeAddEventListener = window.addEventListener.bind(window);

window.onerror = (message, source, lineno, colno, error) => {
  reportError(error || `${message} (${source}:${lineno}:${colno})`);
};

window.onunhandledrejection = (event) => {
  reportError(event.reason || '签名沙箱 Promise 异常');
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`加载脚本失败：${src}`));
    document.documentElement.appendChild(script);
  });
}

const signerReady = (async () => {
  await loadScript('vendor/crypto-js.js');
  await loadScript('signer.js');
  if (!globalThis.XhsSigner?.get_request_headers_params) {
    throw new Error(`签名模块未导出：XhsSigner=${typeof globalThis.XhsSigner}, mnsv2=${typeof globalThis.mnsv2}`);
  }
  globalThis.XhsSigner.get_request_headers_params(
    '/api/sns/web/v2/search/notes',
    '{"keyword":"test","page":1}',
    'test_a1',
    'POST'
  );
  window.parent.postMessage({
    type: 'XHS_SIGNER_READY',
    detail: `mnsv2=${typeof globalThis.mnsv2}`
  }, '*');
})();

signerReady.catch(reportError);

nativeAddEventListener('message', async (event) => {
  const message = event.data || {};
  if (message.type !== 'XHS_SIGN_REQUEST') {
    return;
  }
  try {
    await signerReady;
    const payload = message.payload || {};
    const signed = globalThis.XhsSigner.get_request_headers_params(
      payload.api,
      payload.data || '',
      payload.a1,
      payload.method || 'GET'
    );
    window.parent.postMessage({
      type: 'XHS_SIGN_RESULT',
      id: message.id,
      ok: true,
      signed
    }, '*');
  } catch (error) {
    window.parent.postMessage({
      type: 'XHS_SIGN_RESULT',
      id: message.id,
      ok: false,
      error: String(error?.message || error)
    }, '*');
  }
});
