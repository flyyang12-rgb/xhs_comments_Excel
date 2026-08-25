const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'xhs_chrome_extension', 'search-config.js'),
  'utf8'
);
const context = vm.createContext({});
vm.runInContext(source, context, { filename: 'search-config.js' });

const { buildSearchNotesPayload, createSearchId } = context.XhsSearchConfig;
const baseInput = {
  keyword: '防晒霜',
  page: 1,
  pageSize: 20,
  searchId: 'fixed-search-id',
  sessionId: 'fixed-session-id'
};

const expectedSorts = [
  'general',
  'time_descending',
  'popularity_descending',
  'comment_descending',
  'collect_descending'
];

for (const sortType of expectedSorts) {
  const payload = buildSearchNotesPayload({ ...baseInput, sortType });
  assert.equal(payload.sort, sortType, `${sortType} 必须写入主排序参数`);
  assert.equal(payload.note_type, 0);
  assert.equal(payload.session_id, 'fixed-session-id');
  assert.equal('message_id' in payload, false, '不应再发送旧的 message_id');
  assert.equal('filters' in payload, false, '默认搜索不应携带五组“不限”filters');
}

const videoPayload = buildSearchNotesPayload({ ...baseInput, sortType: 'general', noteType: 1 });
assert.equal(videoPayload.note_type, 1);
assert.equal('filters' in videoPayload, false);

const imagePayload = buildSearchNotesPayload({ ...baseInput, sortType: 'general', noteType: 2 });
assert.equal(imagePayload.note_type, 2);

const expectedTimes = new Map([
  [1, '一天内'],
  [2, '一周内'],
  [3, '半年内']
]);
for (const [noteTime, expectedLabel] of expectedTimes) {
  const payload = buildSearchNotesPayload({ ...baseInput, sortType: 'general', noteTime });
  assert.equal(payload.filters[2].tags[0], expectedLabel);
}

const timedPayload = buildSearchNotesPayload({
  ...baseInput,
  sortType: 'comment_descending',
  noteType: 2,
  noteTime: 2
});
assert.equal(timedPayload.filters.length, 5);
assert.deepEqual(
  JSON.parse(JSON.stringify(timedPayload.filters)),
  [
    { tags: ['comment_descending'], type: 'sort_type' },
    { tags: ['图文'], type: 'filter_note_type' },
    { tags: ['一周内'], type: 'filter_note_time' },
    { tags: ['不限'], type: 'filter_note_range' },
    { tags: ['不限'], type: 'filter_pos_distance' }
  ]
);

assert.equal(createSearchId(1_700_000_000_000, 0.5), '2cgcm1dsehh0lhsfgd3pb');

const fallbackPayload = buildSearchNotesPayload({ ...baseInput, sortType: 'unknown', noteType: 9, noteTime: 9 });
assert.equal(fallbackPayload.sort, 'general');
assert.equal(fallbackPayload.note_type, 0);
assert.equal('filters' in fallbackPayload, false);

console.log('search payload regression tests passed');
