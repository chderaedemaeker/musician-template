// Only the home page and the biography are multilingual for now —
// every other section defaults to the English pages.
module.exports = {
  en: [
    { text: 'About', url: '/en/about/' },
    { text: 'Highlights', url: '/en/highlights/' },
    { text: 'Projects', url: '/en/projects/' },
    { text: 'Concerts', url: '/en/concerts/' },
    { text: 'Contact', url: '/en/contact/' }
  ],
  nl: [
    { text: 'Over', url: '/nl/about/' },
    { text: 'Highlights', url: '/en/highlights/' },
    { text: 'Projects', url: '/en/projects/' },
    { text: 'Concerts', url: '/en/concerts/' },
    { text: 'Contact', url: '/en/contact/' }
  ],
  fr: [
    { text: 'À propos', url: '/fr/about/' },
    { text: 'Highlights', url: '/en/highlights/' },
    { text: 'Projects', url: '/en/projects/' },
    { text: 'Concerts', url: '/en/concerts/' },
    { text: 'Contact', url: '/en/contact/' }
  ],
  de: [
    // No German biography yet — point to the English one
    { text: 'About', url: '/en/about/' },
    { text: 'Highlights', url: '/en/highlights/' },
    { text: 'Projects', url: '/en/projects/' },
    { text: 'Concerts', url: '/en/concerts/' },
    { text: 'Contact', url: '/en/contact/' }
  ]
};
