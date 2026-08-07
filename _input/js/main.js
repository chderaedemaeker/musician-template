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
    var isHero = nav.classList.contains('nav-transparent');
    var lastY = window.scrollY;
    var ticking = false;

    function apply() {
      ticking = false;
      var y = window.scrollY;
      if (isHero) {
        /* the bar is position: sticky — it travels natively. These only
           flip classes: docked size at the pin point, and the veil
           background once the hero photo has fully passed. */
        var pinY = window.innerHeight * 0.5 - nav.offsetHeight / 2;
        if (y >= pinY - 1) nav.classList.add('is-scrolled');
        else if (y < pinY - 40) nav.classList.remove('is-scrolled');
        var pastY = window.innerHeight - nav.offsetHeight;
        if (y >= pastY) nav.classList.add('nav--past');
        else if (y < pastY - 40) nav.classList.remove('nav--past');
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

  /* Build an .ics file for a concert and download it — used by the concert
     modal and the concert detail pages. Opens straight into Apple/Google/
     Outlook calendars, no external service involved. */
  window.downloadConcertIcs = function (c) {
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function fmtDate(d) { return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); }
    function fmtDT(d) { return fmtDate(d) + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00'; }
    function escText(t) { return String(t).replace(/([,;\\])/g, '\\$1'); }
    var start = new Date(c.date);
    var hasTime = !c.monthOnly && !c.dateEnd && (start.getHours() !== 0 || start.getMinutes() !== 0);
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Veronique De Raedemaeker//Concerts//EN', 'BEGIN:VEVENT'];
    if (hasTime) {
      lines.push('DTSTART:' + fmtDT(start));
      lines.push('DTEND:' + fmtDT(new Date(start.getTime() + 2 * 3600 * 1000)));
    } else {
      var end = c.dateEnd ? new Date(c.dateEnd) : new Date(start);
      end.setDate(end.getDate() + 1);
      lines.push('DTSTART;VALUE=DATE:' + fmtDate(start));
      lines.push('DTEND;VALUE=DATE:' + fmtDate(end));
    }
    lines.push('SUMMARY:' + escText((c.title || 'Concert') + ' \u2014 Veronique De Raedemaeker'));
    var descParts = [c.composers, c.collaborators].filter(Boolean).join(' \u2014 ');
    if (c.ticket) descParts = (descParts ? descParts + '\\n' : '') + 'Tickets: ' + c.ticket;
    if (descParts) lines.push('DESCRIPTION:' + escText(descParts));
    if (c.place) lines.push('LOCATION:' + escText(c.place));
    if (c.link) lines.push('URL:' + location.origin + c.link);
    lines.push('UID:' + fmtDate(start) + '-' + (c.title || 'concert').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '@veroniquederaedemaeker.com');
    lines.push('END:VEVENT', 'END:VCALENDAR');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
    a.download = (c.title || 'concert') + '.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  /* Add-to-calendar button on concert detail pages */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.concert-cal-btn');
    if (!btn) return;
    window.downloadConcertIcs({
      title: btn.dataset.title,
      date: btn.dataset.date,
      dateEnd: btn.dataset.dateEnd || '',
      monthOnly: btn.dataset.monthOnly === 'true',
      place: btn.dataset.place || '',
      composers: btn.dataset.composers || '',
      collaborators: btn.dataset.collaborators || '',
      ticket: btn.dataset.ticket || '',
      link: location.pathname
    });
  });

  /* Share and print actions: native share sheet when available,
     otherwise copy the link and confirm with a small tooltip */
  document.addEventListener('click', function (e) {
    var shareBtn = e.target.closest && e.target.closest('.action-share');
    if (shareBtn) {
      var shareUrl = shareBtn.dataset.shareUrl || location.href;
      var payload = { title: shareBtn.dataset.shareTitle || document.title, url: shareUrl };
      if (navigator.share) {
        navigator.share(payload).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(shareUrl).then(function () {
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
