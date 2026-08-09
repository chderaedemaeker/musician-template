const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

// The English entry is the single source of truth for card images:
// localized copies without an image inherit the English one at build time.
const enImageCache = {};
function englishImage(inputPath) {
  const file = path.basename(inputPath);
  const enPath = path.join(path.dirname(path.dirname(inputPath)), 'en', file);
  if (!(enPath in enImageCache)) {
    try { enImageCache[enPath] = matter.read(enPath).data.image || ''; }
    catch (e) { enImageCache[enPath] = ''; }
  }
  return enImageCache[enPath];
}

module.exports = {
  eleventyComputed: {
    permalink: data => {
      if (data.status === 'draft' || data.status === 'archived') return false;
    },
    image: data => data.image || englishImage(data.page.inputPath),
  }
};
