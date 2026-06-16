(function attachResourceSelection(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HicksResourceSelection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createResourceSelection() {
  function releaseDate(item) {
    return String(item && (item.publishedAt || item.scheduledAt) || '');
  }

  function timestampValue(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  }

  function timestamp(item) {
    return timestampValue(releaseDate(item));
  }

  function isPublishedResource(item) {
    return Boolean(
      item &&
      item.validationPassed === true &&
      item.status === 'published' &&
      typeof item.slug === 'string' &&
      item.slug.startsWith('/resources/') &&
      item.slug !== '/resources/'
    );
  }

  function compareNewestFirst(a, b) {
    const publishedDifference = timestamp(b) - timestamp(a);
    if (publishedDifference !== 0) return publishedDifference;
    const scheduledDifference = timestampValue(b && b.scheduledAt) - timestampValue(a && a.scheduledAt);
    if (scheduledDifference !== 0) return scheduledDifference;
    return String(a.slug || a.id || '').localeCompare(String(b.slug || b.id || ''));
  }

  function selectRecentPublishedResources(items, limit = 4) {
    const safeLimit = Number.isInteger(limit) && limit >= 0 ? limit : 4;
    return (Array.isArray(items) ? items : [])
      .filter(isPublishedResource)
      .slice()
      .sort(compareNewestFirst)
      .slice(0, safeLimit);
  }

  return {
    releaseDate,
    timestampValue,
    isPublishedResource,
    compareNewestFirst,
    selectRecentPublishedResources
  };
});
