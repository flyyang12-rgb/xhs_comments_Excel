const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'xhs_chrome_extension', 'note-links.js'), 'utf8');
const context = vm.createContext({ URL });
vm.runInContext(source, context, { filename: 'note-links.js' });
const { extractUrls, isShortLink, parseNoteUrl } = context.XhsNoteLinks;

assert.deepEqual(
  Array.from(extractUrls('复制这篇  https://www.xiaohongshu.com/explore/abc123?xsec_token=token1 ，还有 http://xhslink.com/a/xyz。')),
  ['https://www.xiaohongshu.com/explore/abc123?xsec_token=token1', 'http://xhslink.com/a/xyz']
);
assert.equal(isShortLink('http://xhslink.com/a/xyz'), true);
assert.equal(isShortLink('https://www.xiaohongshu.com/explore/abc123'), false);
assert.deepEqual(
  Array.from(extractUrls('链接：https://www.xiaohongshu.com/explore/abc123. 重复：https://www.xiaohongshu.com/explore/abc123。')),
  ['https://www.xiaohongshu.com/explore/abc123']
);
assert.deepEqual(
  JSON.parse(JSON.stringify(parseNoteUrl('https://www.xiaohongshu.com/explore/abc123?xsec_token=token1&xsec_source=pc_search'))),
  {
    sourceUrl: 'https://www.xiaohongshu.com/explore/abc123?xsec_token=token1&xsec_source=pc_search',
    noteId: 'abc123',
    xsecToken: 'token1',
    xsecSource: 'pc_search'
  }
);
assert.equal(parseNoteUrl('https://www.xiaohongshu.com/user/profile/abc123'), null);
assert.equal(parseNoteUrl('https://example.com/explore/abc123'), null);

console.log('note link parser tests passed');
