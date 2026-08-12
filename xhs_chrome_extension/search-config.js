(function initSearchConfig(root) {
  const SEARCH_SORT_OPTIONS = {
    general: { label: '综合', sort: 'general' },
    time_descending: { label: '最新', sort: 'time_descending' },
    popularity_descending: { label: '最多点赞', sort: 'popularity_descending' },
    comment_descending: { label: '最多评论', sort: 'comment_descending' },
    collect_descending: { label: '最多收藏', sort: 'collect_descending' }
  };

  const NOTE_TYPE_OPTIONS = {
    0: { label: '不限', value: 0 },
    1: { label: '视频', value: 1 },
    2: { label: '图文', value: 2 }
  };

  const NOTE_TIME_OPTIONS = {
    0: { label: '不限', value: 0 },
    1: { label: '一天内', value: 1 },
    2: { label: '一周内', value: 2 },
    3: { label: '半年内', value: 3 }
  };

  function normalizeSearchSort(sortType) {
    return SEARCH_SORT_OPTIONS[sortType] || SEARCH_SORT_OPTIONS.general;
  }

  function normalizeNoteType(noteType) {
    return NOTE_TYPE_OPTIONS[String(noteType)] || NOTE_TYPE_OPTIONS[0];
  }

  function normalizeNoteTime(noteTime) {
    return NOTE_TIME_OPTIONS[String(noteTime)] || NOTE_TIME_OPTIONS[0];
  }

  function createSearchId(now = Date.now(), randomValue = Math.random()) {
    const timestamp = BigInt(Math.max(0, Math.trunc(Number(now) || 0)));
    const randomPart = BigInt(Math.ceil(0x7ffffffe * Math.max(0, Math.min(1, Number(randomValue) || 0))));
    return ((timestamp << 64n) + randomPart).toString(36);
  }

  function buildSearchNotesPayload({
    keyword,
    page,
    pageSize,
    searchId,
    sessionId,
    sortType,
    noteType = 0,
    noteTime = 0
  }) {
    const sortOption = normalizeSearchSort(sortType);
    const typeOption = normalizeNoteType(noteType);
    const timeOption = normalizeNoteTime(noteTime);
    const payload = {
      keyword,
      page,
      page_size: pageSize,
      search_id: searchId,
      sort: sortOption.sort,
      note_type: typeOption.value,
      ext_flags: [],
      geo: '',
      image_formats: ['jpg', 'webp', 'avif'],
      session_id: sessionId
    };

    if (timeOption.value !== 0) {
      payload.filters = [
        { tags: [sortOption.sort], type: 'sort_type' },
        { tags: [typeOption.label], type: 'filter_note_type' },
        { tags: [timeOption.label], type: 'filter_note_time' },
        { tags: ['不限'], type: 'filter_note_range' },
        { tags: ['不限'], type: 'filter_pos_distance' }
      ];
    }

    return payload;
  }

  root.XhsSearchConfig = Object.freeze({
    SEARCH_SORT_OPTIONS,
    NOTE_TYPE_OPTIONS,
    NOTE_TIME_OPTIONS,
    normalizeSearchSort,
    normalizeNoteType,
    normalizeNoteTime,
    createSearchId,
    buildSearchNotesPayload
  });
})(globalThis);
