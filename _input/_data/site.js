// Netlify sets URL to the site's primary address (custom domain once
// configured, *.netlify.app before that) — absolute links for social
// cards must point at wherever THIS build is actually served.
module.exports = {
  url: process.env.URL || "https://veroniquederaedemaeker.com",
};
