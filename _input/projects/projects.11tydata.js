module.exports = {
  eleventyComputed: {
    permalink: data => {
      if (data.status === 'draft' || data.status === 'archived') return false;
    }
  }
};
