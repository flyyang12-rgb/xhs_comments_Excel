const signerFrame = document.getElementById('signerFrame');
const pendingSigns = new Map();
let signerReady = false;
let signerError = '';
let signerLoaded = false;

signerFrame.addEventListener('load', () => {
  signerLoaded = true;
});

window.addEventListener('message', (event) => {
  if (event.source !== signerFrame.contentWindow) {
    return;
  }
  const message = event.data || {};
  if (message.type === 'XHS_SIGNER_READY') {
    signerReady = true;
    signerError = '';
    return;
  }
  if (message.type === 'XHS_SIGNER_ERROR') {
    signerError = message.error || '签名沙箱初始化失败';
    for (const [id, pending] of pendingSigns.entries()) {
      pendingSigns.delete(id);
      clearTimeout(pending.timer);
      pending.reject(new Error(signerError));
    }
    return;
  }
  if (message.type !== 'XHS_SIGN_RESULT') {
    return;
  }
  const pending = pendingSigns.get(message.id);
  if (!pending) {
    return;
  }
  pendingSigns.delete(message.id);
  clearTimeout(pending.timer);
  if (message.ok) {
    pending.resolve(message.signed);
  } else {
    pending.reject(new Error(message.error || '签名失败'));
  }
});

async function waitForSignerReady() {
  if (signerError) {
    throw new Error(signerError);
  }
  if (signerReady) {
    return;
  }
  const started = Date.now();
  while (!signerReady && !signerError && Date.now() - started < 12000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (signerError) {
    throw new Error(signerError);
  }
  if (!signerReady) {
    throw new Error(`签名页未就绪：loaded=${signerLoaded}`);
  }
}

async function signInSandbox(payload) {
  await waitForSignerReady();
  const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingSigns.delete(id);
      reject(new Error(`签名页无响应：loaded=${signerLoaded}, ready=${signerReady}`));
    }, 12000);
    pendingSigns.set(id, { resolve, reject, timer });
    signerFrame.contentWindow.postMessage({
      type: 'XHS_SIGN_REQUEST',
      id,
      payload
    }, '*');
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'SIGN_XHS_REQUEST') {
    return false;
  }
  signInSandbox(message)
    .then((signed) => sendResponse({ ok: true, signed }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});
