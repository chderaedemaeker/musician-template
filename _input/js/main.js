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

  /* Navbar behavior: the bar fades away while scrolling down (only the
     name stays); it returns on scroll-up. On the home page the name
     starts big over the photo and settles once scrolling begins. */
  document.addEventListener('DOMContentLoaded', function () {
    var nav = document.querySelector('.nav');
    if (!nav) return;
    var brand = nav.querySelector('.nav-brand');
    var isHero = nav.classList.contains('nav-transparent');
    var lastY = window.scrollY;
    var ticking = false;

    /* On the home page the name travels with the scroll, pixel for
       pixel, from the middle of the hero up into the bar. */
    var brandLink = brand ? brand.querySelector('a') : null;
    function moveBrand(y) {
      if (!brand || !brandLink) return;
      var vh = window.innerHeight;
      var small = window.matchMedia('(max-width: 768px)').matches;
      var startSize = small ? 45.6 : 72;   /* px — matches the stylesheet */
      var endSize = 24;                    /* 1.5rem dock size */
      var p = Math.min(1, Math.max(0, y / (vh * 0.6)));
      if (p >= 1) {
        /* journey done — hand back to the stylesheet so the name sits
           exactly where the bar's own rules put it (left, in flow) */
        brand.style.transition = '';
        brand.style.position = '';
        brand.style.left = '';
        brand.style.top = '';
        brand.style.transform = '';
        brandLink.style.fontSize = '';
        return p;
      }
      var inner = nav.querySelector('.nav-inner');
      var gutter = inner ? parseFloat(getComputedStyle(inner).paddingLeft) || 24 : 24;
      var startY = vh * 0.5;
      var endY = nav.offsetHeight / 2;
      brand.style.transition = 'none';
      brand.style.position = 'fixed';
      brand.style.left = gutter + 'px';
      brand.style.top = (startY + (endY - startY) * p) + 'px';
      brand.style.transform = 'translateY(-50%)';
      /* real font-size per frame keeps the glyphs crisp — no raster scaling */
      brandLink.style.fontSize = (startSize + (endSize - startSize) * p) + 'px';
      return p;
    }

    function apply() {
      ticking = false;
      var y = window.scrollY;
      if (isHero && !reducedMotion) {
        var p = moveBrand(y);
        if (p >= 1) nav.classList.add('is-scrolled');
        else if (p < 0.95) nav.classList.remove('is-scrolled');
      } else {
        /* hysteresis: no flickering around a single threshold */
        if (y > 90) nav.classList.add('is-scrolled');
        else if (y < 40) nav.classList.remove('is-scrolled');
      }
      var delta = y - lastY;
      if (Math.abs(delta) > 8) {
        if (delta > 0 && y > 280) nav.classList.add('nav--quiet');
        else if (delta < 0) nav.classList.remove('nav--quiet');
        lastY = y;
      }
      if (y <= 90) nav.classList.remove('nav--quiet');
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(apply); }
    }, { passive: true });
    window.addEventListener('resize', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(apply); }
    });
    apply();
  });

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

    /* Each group reveals its members with a stagger the moment the
       group scrolls into view */
    var groupIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        Array.prototype.forEach.call(entry.target.querySelectorAll('.reveal'), function (el, i) {
          el.style.transitionDelay = Math.min(i * 90, 700) + 'ms';
          el.classList.add('is-visible');
        });
        groupIo.unobserve(entry.target);
      });
    }, { threshold: 0.08 });
    document.querySelectorAll('.reveal-group').forEach(function (group) {
      groupIo.observe(group);
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

  /* Language picker popup */
  document.addEventListener('DOMContentLoaded', function () {
    var picker = document.querySelector('.lang-picker');
    if (!picker) return;
    var btn = picker.querySelector('.lang-picker-btn');
    var menu = picker.querySelector('.lang-picker-menu');
    function setOpen(open) {
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(menu.hidden);
    });
    document.addEventListener('click', function (e) {
      if (!picker.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setOpen(false);
    });
  });

  /* About gallery: cross-fade carousel with auto-advance */
  document.addEventListener('DOMContentLoaded', function () {
    var gallery = document.querySelector('.about-gallery');
    if (!gallery) return;
    var imgs = Array.prototype.slice.call(gallery.querySelectorAll('.gallery-slide'));
    if (imgs.length < 2) return;
    var index = 0;
    var timer = null;
    function show(i) {
      var prev = index;
      index = (i + imgs.length) % imgs.length;
      imgs.forEach(function (img, j) {
        /* the outgoing slide stays fully visible underneath while the new
           one dissolves in on top — no flash of the background between them */
        img.classList.toggle('was-active', j === prev && prev !== index);
        img.classList.toggle('is-active', j === index);
      });
    }
    function schedule() {
      if (reducedMotion) return;
      clearInterval(timer);
      timer = setInterval(function () { show(index + 1); }, 5000);
    }
    schedule();
  });

  /* Share and print actions: native share sheet when available,
     otherwise copy the link and confirm with a small tooltip */
  document.addEventListener('click', function (e) {
    var shareBtn = e.target.closest && e.target.closest('.action-share');
    if (shareBtn) {
      var payload = { title: document.title, url: location.href };
      if (navigator.share) {
        navigator.share(payload).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(location.href).then(function () {
          shareBtn.classList.add('is-copied');
          setTimeout(function () { shareBtn.classList.remove('is-copied'); }, 1800);
        });
      }
      return;
    }
    if (e.target.closest && e.target.closest('.action-print')) {
      window.print();
    }
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
