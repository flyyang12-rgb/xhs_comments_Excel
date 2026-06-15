(function installHook() {
  if (window.__xhsCollectorHookInstalled) {
    window.postMessage({
      source: 'xhs-collector-page',
      payload: {
        kind: 'hook-status',
        message: 'hook already installed',
        captureTime: Date.now()
      }
    }, '*');
    return;
  }
  window.__xhsCollectorHookInstalled = true;

  function isSearchNotesUrl(url) {
    return String(url || '').includes('/api/sns/web/v2/search/notes');
  }

  function normalizeUrl(url) {
    try {
      return new URL(String(url || ''), location.origin).href;
    } catch (_) {
      return String(url || '');
    }
  }

  function post(payload) {
    window.postMessage({
      source: 'xhs-collector-page',
      payload: {
        ...payload,
        searchGeneration: payload.searchGeneration ?? window.__xhsCollectorSearchGeneration ?? 0,
        captureTime: Date.now()
      }
    }, '*');
  }

  post({
    kind: 'hook-status',
    message: 'hook installed'
  });

  const originalFetch = window.fetch;
  window.fetch = async function patchedFetch(...args) {
    const response = await originalFetch.apply(this, args);
    const input = args[0];
    const init = args[1] || {};
    const url = normalizeUrl(input?.url || input);
    const requestGeneration = window.__xhsCollectorSearchGeneration || 0;
    if (isSearchNotesUrl(url)) {
      response.clone().json().then((body) => post({
        kind: 'search-notes',
        transport: 'fetch',
        method: input?.method || init.method || 'GET',
        url,
        body,
        searchGeneration: requestGeneration
      })).catch(() => {});
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    this.__xhsCollectorMethod = method || 'GET';
    this.__xhsCollectorUrl = normalizeUrl(url);
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function patchedSend(...args) {
    if (isSearchNotesUrl(this.__xhsCollectorUrl)) {
      this.__xhsCollectorSearchGeneration = window.__xhsCollectorSearchGeneration || 0;
      this.addEventListener('load', () => {
        try {
          post({
            kind: 'search-notes',
            transport: 'xhr',
            method: this.__xhsCollectorMethod || 'GET',
            url: String(this.__xhsCollectorUrl),
            body: JSON.parse(this.responseText),
            searchGeneration: this.__xhsCollectorSearchGeneration || 0
          });
        } catch (_) {}
      });
    }
    return originalSend.apply(this, args);
  };
})();
