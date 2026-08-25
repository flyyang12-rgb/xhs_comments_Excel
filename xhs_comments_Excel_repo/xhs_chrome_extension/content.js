const script = document.createElement('script');
script.src = chrome.runtime.getURL('page-hook.js');
script.dataset.xhsCollectorHook = '1';
(document.documentElement || document.head).appendChild(script);
script.remove();

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'xhs-collector-page') {
    return;
  }
  chrome.runtime.sendMessage({
    type: 'SEARCH_RESPONSE_CAPTURED',
    payload: event.data.payload
  });
});
