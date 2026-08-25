(function initNoteLinks(root) {
  const URL_PATTERN = /https?:\/\/[^\s<>'"，。；、）】]+/gi;
  const NOTE_PATHS = [
    /^\/explore\/([a-zA-Z0-9]+)\/?$/,
    /^\/discovery\/item\/([a-zA-Z0-9]+)\/?$/,
    /^\/search_result\/([a-zA-Z0-9]+)\/?$/
  ];

  function extractUrls(text) {
    const urls = String(text || '').match(URL_PATTERN) || [];
    return Array.from(new Set(urls.map((url) => url.replace(/[),.;!?\]}]+$/, ''))));
  }

  function isShortLink(url) {
    try {
      return new URL(url).hostname.toLowerCase() === 'xhslink.com';
    } catch (_) {
      return false;
    }
  }

  function parseNoteUrl(rawUrl) {
    let url;
    try {
      url = new URL(String(rawUrl || '').trim());
    } catch (_) {
      return null;
    }
    const host = url.hostname.toLowerCase();
    if (host !== 'xiaohongshu.com' && !host.endsWith('.xiaohongshu.com')) {
      return null;
    }
    let noteId = '';
    for (const pattern of NOTE_PATHS) {
      const match = url.pathname.match(pattern);
      if (match) {
        noteId = match[1];
        break;
      }
    }
    if (!noteId) {
      return null;
    }
    return {
      sourceUrl: url.href,
      noteId,
      xsecToken: url.searchParams.get('xsec_token') || '',
      xsecSource: url.searchParams.get('xsec_source') || 'pc_feed'
    };
  }

  root.XhsNoteLinks = Object.freeze({ extractUrls, isShortLink, parseNoteUrl });
})(globalThis);
