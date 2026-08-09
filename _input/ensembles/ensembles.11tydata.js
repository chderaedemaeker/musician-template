const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

// The English entry is the single source of truth for card images and
// ordering: localized copies inherit both at build time.
const enFrontCache = {};
function englishFront(inputPath) {
  const file = path.basename(inputPath);
  const enPath = path.join(path.dirname(path.dirname(inputPath)), 'en', file);
  if (!(enPath in enFrontCache)) {
    try { enFrontCache[enPath] = matter.read(enPath).data || {}; }
    catch (e) { enFrontCache[enPath] = {}; }
  }
  return enFrontCache[enPath];
}

module.exports = {
  eleventyComputed: {
    permalink: data => {
      if (data.status === 'draft' || data.status === 'archived') return false;
      if (data.lang && data.lang !== 'en') return false;
    },
    image: data => data.image || englishFront(data.page.inputPath).image || '',
    // Drag-ordered in the admin; entries without an order sort last,
    // newest first among themselves.
    sortOrder: data => {
      const order = data.order != null ? data.order : (englishFront(data.page.inputPath).order != null ? englishFront(data.page.inputPath).order : 9999);
      const ts = data.date ? new Date(data.date).getTime() : 0;
      return order * 1e13 + (1e13 - ts);
    },
  }
};
