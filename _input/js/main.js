(function () {
  'use strict';

  /* Language switcher — only the home page and the biography are
     multilingual; from any other page, switching goes to that
     language's home page. German has no biography yet. */
  window.switchLanguage = function (lang) {
    var path = window.location.pathname;
    var multilingual = path.match(/^\/(en|nl|fr|de)\/(about\/)?$/);
    if (multilingual) {
      if (multilingual[2] && lang === 'de') { window.location.href = '/en/about/'; return; }
      window.location.href = path.replace(/^\/(en|nl|fr|de)/, '/' + lang);
      return;
    }
    window.location.href = '/' + lang + '/';
  };

  /* Mobile navigation */
  window.toggleMobileNav = function () {
    var hamburger = document.querySelector('.hamburger');
    var mobileNav = document.getElementById('mobile-nav');
    if (!hamburger || !mobileNav) return;
    var open = mobileNav.classList.toggle('open');
    hamburger.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.style.overflow = open ? 'hidden' : '';
  };

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Reveal animations. Elements in a .reveal-group (card grids) flow in
     on load with a tiny stagger — waiting for scroll would hide that
     there is more below the fold. Standalone .reveal elements still
     appear as they scroll into view. */
  document.addEventListener('DOMContentLoaded', function () {
    var els = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
    if (!els.length) return;
    if (reducedMotion || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }

    var grouped = els.filter(function (el) { return el.closest('.reveal-group'); });
    var solo = els.filter(function (el) { return !el.closest('.reveal-group'); });

    document.querySelectorAll('.reveal-group').forEach(function (group) {
      Array.prototype.forEach.call(group.querySelectorAll('.reveal'), function (el, i) {
        el.style.transitionDelay = Math.min(i * 70, 700) + 'ms';
      });
    });
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        grouped.forEach(function (el) { el.classList.add('is-visible'); });
      });
    });

    if (!solo.length) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -10% 0px' });
    solo.forEach(function (el) { io.observe(el); });
  });

  /* Keep Tab inside a dialog. Call from a keydown handler when e.key === 'Tab'. */
  window.siteTrapFocus = function (container, e) {
    var focusables = container.querySelectorAll(
      'a[href]:not([hidden]), button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) { e.preventDefault(); return; }
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
})();
