/* ==========================================================================
   NearBuyGoods — landing page behaviour
   Zero dependencies, no build step, CSP-friendly (external file, no inline JS).
   Sections: preloader · scroll chrome · drawer · reveal · counters · sliders ·
             accordion · scroll-spy · parallax · reduce-motion · platform hint
   ========================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var mq = function (q) { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } };
  var reduce = function () { return root.classList.contains('reduce-motion') || mq('(prefers-reduced-motion: reduce)'); };

  /* ---------------------------------------------------- motion preference */
  try { if (localStorage.getItem('nbg_reduce_motion') === '1') root.classList.add('reduce-motion'); } catch (e) { /* private mode */ }
  var mToggle = $('#motion-toggle');
  if (mToggle) {
    var syncToggle = function () { mToggle.classList.toggle('on', root.classList.contains('reduce-motion')); mToggle.setAttribute('aria-pressed', root.classList.contains('reduce-motion') ? 'true' : 'false'); };
    syncToggle();
    mToggle.addEventListener('click', function () {
      root.classList.toggle('reduce-motion');
      try { localStorage.setItem('nbg_reduce_motion', root.classList.contains('reduce-motion') ? '1' : '0'); } catch (e) { /* ignore */ }
      syncToggle();
    });
  }

  /* ------------------------------------------------------------- preloader */
  var pre = $('#preload');
  function hidePre() { if (pre && !pre.classList.contains('done')) pre.classList.add('done'); }
  window.addEventListener('load', function () { setTimeout(hidePre, 420); });
  setTimeout(hidePre, 2600); // fail-safe: never trap the page behind the splash
  if (document.readyState === 'complete') setTimeout(hidePre, 420);

  /* -------------------------------------------------- scroll chrome + spy */
  var top = $('#top'), bar = $('#progress'), totop = $('#totop');
  var navLinks = $$('.top .nav a[href^="#"]');
  var sections = navLinks.map(function (a) { return $(a.getAttribute('href')); }).filter(Boolean);
  var ticking = false;
  function onScroll() {
    var y = window.scrollY || window.pageYOffset;
    if (top) top.classList.toggle('stuck', y > 12);
    if (bar) {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (h > 0 ? Math.min(100, (y / h) * 100) : 0) + '%';
    }
    if (totop) totop.classList.toggle('show', y > 700);
    var active = null;
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].getBoundingClientRect().top <= 140) active = sections[i].id;
    }
    navLinks.forEach(function (a) { a.classList.toggle('active', a.getAttribute('href') === '#' + active); });
    ticking = false;
  }
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();

  if (totop) totop.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: reduce() ? 'auto' : 'smooth' });
  });

  /* ----------------------------------------------------------- mobile menu */
  var burger = $('#burger'), drawer = $('#drawer');
  function setMenu(open) {
    document.body.classList.toggle('menu-open', open);
    if (drawer) drawer.classList.toggle('show', open);
    if (burger) burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (burger) burger.addEventListener('click', function () { setMenu(!document.body.classList.contains('menu-open')); });
  if (drawer) $$('a, button', drawer).forEach(function (el) { el.addEventListener('click', function () { setMenu(false); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
  window.addEventListener('resize', function () { if (window.innerWidth > 1080) setMenu(false); });

  /* --------------------------------------------------------- reveal on view */
  var reveals = $$('.reveal');
  if ('IntersectionObserver' in window && !reduce()) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  /* ----------------------------------------------------------- counters */
  var counters = $$('[data-count]');
  function runCounter(el) {
    var target = parseFloat(el.getAttribute('data-count')) || 0;
    var dec = (el.getAttribute('data-dec') || '0') | 0;
    var dur = 1400, t0 = null;
    if (reduce()) { el.textContent = target.toFixed(dec); return; }
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = (target * eased).toFixed(dec);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if (counters.length) {
    if ('IntersectionObserver' in window) {
      var cio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { runCounter(en.target); cio.unobserve(en.target); } });
      }, { threshold: 0.4 });
      counters.forEach(function (el) { cio.observe(el); });
    } else counters.forEach(runCounter);
  }

  /* ------------------------------------------------------------ faq accordion */
  $$('.faq-item').forEach(function (item) {
    var q = $('.faq-q', item), a = $('.faq-a', item);
    if (!q || !a) return;
    q.setAttribute('aria-expanded', 'false');
    q.addEventListener('click', function () {
      var open = item.classList.contains('open');
      if (!open) {
        a.style.maxHeight = a.scrollHeight + 'px';
        item.classList.add('open');
        q.setAttribute('aria-expanded', 'true');
      } else {
        a.style.maxHeight = '0px';
        item.classList.remove('open');
        q.setAttribute('aria-expanded', 'false');
      }
    });
  });

  /* --------------------------------------------------------------- sliders */
  function slider(cfg) {
    var track = $(cfg.track), dotsBox = $(cfg.dots);
    if (!track) return null;
    var slides = $$(cfg.slide, track);
    var index = 0;
    function render() {
      if (cfg.mode === 'scroll') {
        var base = slides.length ? slides[0].offsetLeft : 0;
        var target = slides[index] ? slides[index].offsetLeft - base : 0;
        if (track.scrollTo) track.scrollTo({ left: target, behavior: reduce() ? 'auto' : 'smooth' });
        else track.scrollLeft = target;
        if (cfg.prev) $(cfg.prev).disabled = index === 0;
        if (cfg.next) $(cfg.next).disabled = index === slides.length - 1;
      } else {
        track.style.transform = 'translateX(' + (-index * 100) + '%)';
      }
      if (dotsBox) $$('button', dotsBox).forEach(function (d, i) { d.classList.toggle('on', i === index); d.setAttribute('aria-current', i === index ? 'true' : 'false'); });
      if (cfg.onIndex) cfg.onIndex(index);
    }
    function go(i) { index = Math.max(0, Math.min(slides.length - 1, i)); render(); }
    if (dotsBox) {
      dotsBox.innerHTML = '';
      slides.forEach(function (_, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', 'Go to ' + (cfg.label || 'slide') + ' ' + (i + 1));
        b.addEventListener('click', function () { go(i); });
        dotsBox.appendChild(b);
      });
    }
    if (cfg.prev) $(cfg.prev).addEventListener('click', function () { go(index - 1); });
    if (cfg.next) $(cfg.next).addEventListener('click', function () { go(index + 1); });
    if (cfg.mode === 'scroll') {
      var onScrollEnd = function () {
        var base = slides.length ? slides[0].offsetLeft : 0;
        var best = 0, bd = Infinity;
        slides.forEach(function (sl, i) {
          var d = Math.abs((sl.offsetLeft - base) - track.scrollLeft);
          if (d < bd) { bd = d; best = i; }
        });
        if (best !== index) { index = best; render(); }
      };
      var st;
      track.addEventListener('scroll', function () { clearTimeout(st); st = setTimeout(onScrollEnd, 90); }, { passive: true });
    }
    window.addEventListener('resize', render);
    if (cfg.autoplay) {
      var timer = null;
      var start = function () { if (!reduce()) timer = setInterval(function () { go(index + 1 >= slides.length ? 0 : index + 1); }, cfg.autoplay); };
      var stop = function () { if (timer) clearInterval(timer); timer = null; };
      track.addEventListener('mouseenter', stop); track.addEventListener('mouseleave', start);
      track.addEventListener('focusin', stop); track.addEventListener('focusout', start);
      if (cfg.viewport || track.parentElement) {
        var vp = cfg.viewport ? $(cfg.viewport) : track.parentElement;
        ['pointerdown', 'touchstart'].forEach(function (ev) { vp.addEventListener(ev, stop, { passive: true }); });
        ['pointerup', 'touchend'].forEach(function (ev) { vp.addEventListener(ev, function () { stop(); start(); }, { passive: true }); });
      }
      start();
    }
    // pointer drag (testimonials)
    if (cfg.drag) {
      var startX = 0, dragging = false;
      track.parentElement.addEventListener('pointerdown', function (e) { dragging = true; startX = e.clientX; });
      window.addEventListener('pointerup', function (e) {
        if (!dragging) return; dragging = false;
        var dx = e.clientX - startX;
        if (Math.abs(dx) > 45) go(index + (dx < 0 ? 1 : -1));
      });
    }
    render();
    return { go: go, index: function () { return index; } };
  }

  slider({
    track: '#tst-track', dots: '#tst-dots', slide: '.tst', label: 'review',
    prev: '#tst-prev', next: '#tst-next', autoplay: 7000, drag: true, viewport: '#tst-viewport',
  });

  slider({
    track: '#screens-track', dots: '#screens-dots', slide: '.screen-item', label: 'screen',
    prev: '#screens-prev', next: '#screens-next', mode: 'scroll',
  });

  /* ------------------------------------------------------- hero parallax */
  var hv = $('#hero-visual');
  if (hv && !reduce() && mq('(hover: hover)')) {
    var layers = $$('[data-depth]', hv);
    hv.addEventListener('pointermove', function (e) {
      var r = hv.getBoundingClientRect();
      var cx = (e.clientX - r.left) / r.width - 0.5;
      var cy = (e.clientY - r.top) / r.height - 0.5;
      layers.forEach(function (el) {
        var d = parseFloat(el.getAttribute('data-depth')) || 8;
        el.style.transform = 'translate3d(' + (-cx * d) + 'px,' + (-cy * d) + 'px,0)';
      });
    });
    hv.addEventListener('pointerleave', function () { layers.forEach(function (el) { el.style.transform = ''; }); });
  }

  /* ------------------------------------------------------- platform hint */
  var hint = $('#platform-hint');
  if (hint) {
    var ua = navigator.userAgent || '';
    var isAndroid = /Android/i.test(ua);
    var isiOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var text = hint.getAttribute(isAndroid ? 'data-android' : isiOS ? 'data-ios' : 'data-desktop');
    if (text) hint.textContent = text;
    if (isAndroid) $$('[data-store="play"]').forEach(function (el) { el.classList.add('pulse'); });
  }

  /* ------------------------------------------------- coming-soon badges */
  /* The App Store / Google Play badges stay at href="#" until the app is live
     in both stores; keep them inert instead of jumping the reader to the top. */
  $$('a[href="#"]').forEach(function (el) {
    el.addEventListener('click', function (e) { e.preventDefault(); });
  });

  /* ---------------------------------------------------------------- misc */
  var yr = $('#year');
  if (yr) yr.textContent = String(new Date().getFullYear());
})();
