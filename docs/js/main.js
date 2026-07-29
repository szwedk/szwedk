/* ============================================================
   Kamil Szwed — portfolio
   Lenis smooth scroll + GSAP ScrollTrigger + canvas particle hero
   ============================================================ */

(function () {
  'use strict';

  gsap.registerPlugin(ScrollTrigger);

  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var motionOn = !prefersReduced;

  /* ---------- deterministic rng ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function smoothstep(e0, e1, x) {
    var t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  /* ============================================================
     Particle hero
     ============================================================ */
  var heroFX = (function () {
    var canvas = document.getElementById('heroCanvas');
    var ctx = canvas.getContext('2d');
    var img = new Image();
    var imgReady = false;
    var particles = null;   // typed arrays
    var count = 0;
    var draw = { x: 0, y: 0, w: 0, h: 0 };
    var DPR = 1;
    var targetP = 0, curP = 0;
    var mouseX = 0, mouseY = 0, parX = 0, parY = 0;
    var rafId = null;
    var running = false;
    var staticMode = false;
    var heroVisible = true;

    img.onload = function () { imgReady = true; resize(); kick(); };
    img.onerror = function () { /* headline copy still works without the image */ };
    img.src = 'assets/portrait.jpg';

    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      var W = canvas.clientWidth, H = canvas.clientHeight;
      if (!W || !H) return;
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      if (!imgReady) return;

      var scale = Math.min((H * 0.82) / img.height, (W * 0.92) / img.width);
      draw.w = img.width * scale;
      draw.h = img.height * scale;
      draw.x = (W - draw.w) / 2;
      draw.y = (H - draw.h) / 2;
      buildParticles();
      dirty = true;
    }

    function buildParticles() {
      // sample the image on an offscreen canvas
      var isMobile = window.innerWidth < 700;
      var targetCols = isMobile ? 80 : 120;
      var sw = targetCols;
      var sh = Math.round(targetCols * (img.height / img.width));
      var off = document.createElement('canvas');
      off.width = sw; off.height = sh;
      var octx = off.getContext('2d', { willReadFrequently: true });
      octx.drawImage(img, 0, 0, sw, sh);
      var data;
      try {
        data = octx.getImageData(0, 0, sw, sh).data;
      } catch (e) { particles = null; return; }

      var px = [], py = [], pr = [], pg = [], pb = [], ps = [], seeds = [];
      var stepX = draw.w / sw, stepY = draw.h / sh;
      for (var j = 0; j < sh; j++) {
        for (var i = 0; i < sw; i++) {
          var k = (j * sw + i) * 4;
          var r = data[k], g = data[k + 1], b = data[k + 2];
          var lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (lum < 9) continue; // skip the black backdrop
          px.push(draw.x + i * stepX + stepX / 2);
          py.push(draw.y + j * stepY + stepY / 2);
          pr.push(r); pg.push(g); pb.push(b);
          ps.push(Math.max(1, (0.55 + (lum / 255) * 0.9) * stepX * 0.62));
          seeds.push(j * sw + i);
        }
      }
      count = px.length;
      particles = {
        x: new Float32Array(px), y: new Float32Array(py),
        r: new Uint8Array(pr), g: new Uint8Array(pg), b: new Uint8Array(pb),
        s: new Float32Array(ps),
        ang: new Float32Array(count), dist: new Float32Array(count),
        a0: new Float32Array(count), drip: new Float32Array(count),
        wob: new Float32Array(count), phase: new Float32Array(count)
      };
      var cx = draw.x + draw.w / 2, cy = draw.y + draw.h * 0.42;
      for (var n = 0; n < count; n++) {
        var rng = mulberry32(seeds[n] * 2654435761);
        var nx = (particles.x[n] - draw.x) / draw.w; // 0..1 left→right
        // scatter direction: mostly away from face center, biased up-right
        var base = Math.atan2(particles.y[n] - cy, particles.x[n] - cx);
        particles.ang[n] = base + (rng() - 0.5) * 1.6;
        particles.dist[n] = (40 + rng() * 210) * (0.6 + rng() * 0.8);
        // dissolve sweeps right → left (like the reference's half-particle face)
        particles.a0[n] = 0.14 + ((1 - nx) * 0.62 + rng() * 0.38) * 0.5;
        particles.drip[n] = rng() < 0.18 ? 0.5 + rng() * 1.3 : rng() * 0.25;
        particles.wob[n] = 6 + rng() * 22;
        particles.phase[n] = rng() * Math.PI * 2;
      }
    }

    var dirty = true;
    function render(t) {
      var W = canvas.width, H = canvas.height;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);

      if (!imgReady) return;

      var p = staticMode ? 0 : curP;
      var ox = parX, oy = parY;

      // 1) the photo itself, fading out as dissolution takes over
      var imgAlpha = 1 - smoothstep(0.10, 0.34, p);
      if (imgAlpha > 0.004) {
        ctx.globalAlpha = imgAlpha;
        ctx.drawImage(img, draw.x + ox, draw.y + oy, draw.w, draw.h);
      }

      // 2) particles
      if (particles && p > 0.02) {
        var time = t * 0.001;
        var meltT = Math.max(0, p - 0.62);
        var melt = meltT * meltT;
        var vh = canvas.clientHeight;
        for (var n = 0; n < count; n++) {
          var act = smoothstep(particles.a0[n], particles.a0[n] + 0.17, p);
          if (act <= 0.001) continue;
          var ease = act * act;
          var d = particles.dist[n] * ease;
          var x = particles.x[n] + Math.cos(particles.ang[n]) * d + ox;
          var y = particles.y[n] + Math.sin(particles.ang[n]) * d * 0.7 + oy;
          x += Math.sin(time * 0.9 + particles.phase[n]) * particles.wob[n] * act;
          y += Math.cos(time * 0.7 + particles.phase[n] * 1.3) * particles.wob[n] * 0.6 * act;
          // late-phase: streak downward like melting chrome
          var dripAmt = melt * particles.drip[n] * vh * 1.05;
          y += dripAmt;
          var sz = particles.s[n] * (0.8 + act * 0.5);
          var stretch = 1 + melt * particles.drip[n] * 26;
          ctx.globalAlpha = act * (1 - melt * 0.55);
          ctx.fillStyle = 'rgb(' + particles.r[n] + ',' + particles.g[n] + ',' + particles.b[n] + ')';
          ctx.fillRect(x, y, sz, sz * stretch);
        }
      }
      ctx.globalAlpha = 1;
    }

    function frame(t) {
      rafId = requestAnimationFrame(frame);
      if (!heroVisible && !dirty) return;
      var animating = !staticMode && curP > 0.02 && curP < 1;
      curP += (targetP - curP) * 0.14;
      if (Math.abs(targetP - curP) < 0.0004) curP = targetP;
      parX += ((mouseX * 16) - parX) * 0.05;
      parY += ((mouseY * 10) - parY) * 0.05;
      var parMoving = Math.abs(mouseX * 16 - parX) > 0.1 || Math.abs(mouseY * 10 - parY) > 0.1;
      if (dirty || animating || Math.abs(targetP - curP) > 0.0004 || parMoving) {
        render(t);
        dirty = false;
      }
    }

    function kick() {
      if (rafId === null) rafId = requestAnimationFrame(frame);
    }

    window.addEventListener('resize', function () {
      clearTimeout(resize._t);
      resize._t = setTimeout(resize, 150);
    });
    window.addEventListener('mousemove', function (e) {
      if (staticMode) return;
      mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
      mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
      dirty = true;
    });

    resize();
    kick();

    return {
      setProgress: function (p) { targetP = p; },
      setVisible: function (v) { heroVisible = v; dirty = dirty || v; },
      setStatic: function (s) {
        staticMode = s;
        if (s) { targetP = 0; curP = 0; }
        dirty = true;
      }
    };
  })();

  /* ============================================================
     Word splitting for the manifesto
     ============================================================ */
  var manifestoWords = (function () {
    var el = document.getElementById('manifestoText');
    var nodes = Array.prototype.slice.call(el.childNodes);
    var frag = document.createDocumentFragment();
    nodes.forEach(function (node) {
      if (node.nodeType === 3) {
        node.textContent.split(/\s+/).filter(Boolean).forEach(function (w) {
          var s = document.createElement('span');
          s.className = 'word';
          s.textContent = w;
          frag.appendChild(s);
          frag.appendChild(document.createTextNode(' '));
        });
      } else if (node.nodeType === 1) {
        var s2 = document.createElement('span');
        s2.className = 'word';
        s2.appendChild(node.cloneNode(true));
        frag.appendChild(s2);
        frag.appendChild(document.createTextNode(' '));
      }
    });
    el.innerHTML = '';
    el.appendChild(frag);
    return Array.prototype.slice.call(el.querySelectorAll('.word'));
  })();

  /* ============================================================
     Motion context — everything revertable lives in here
     ============================================================ */
  var lenis = null;
  var ctx = null;

  function initMotion() {
    document.documentElement.classList.remove('no-motion');
    heroFX.setStatic(false);

    lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(tickLenis);
    gsap.ticker.lagSmoothing(0);

    ctx = gsap.context(function () {

      /* ----- hero: canvas progress + headline crossfades ----- */
      ScrollTrigger.create({
        trigger: '.hero',
        start: 'top top',
        end: 'bottom bottom',
        scrub: true,
        onUpdate: function (self) { heroFX.setProgress(self.progress); },
        onToggle: function (self) { heroFX.setVisible(self.isActive); }
      });

      var h = function (i) { return '.hero-headline[data-headline="' + i + '"]'; };
      gsap.set(h(1), { yPercent: -50 });
      gsap.set(h(2), { yPercent: -50 });

      var tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: '.hero',
          start: 'top top',
          end: 'bottom bottom',
          scrub: true
        }
      });
      tl.to(h(0), { autoAlpha: 0, y: -70, filter: 'blur(9px)', duration: 9 }, 21)
        .fromTo(h(1), { autoAlpha: 0, y: 70, filter: 'blur(9px)' },
                      { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 9 }, 30)
        .to(h(1), { autoAlpha: 0, y: -70, filter: 'blur(9px)', duration: 9 }, 55)
        .fromTo(h(2), { autoAlpha: 0, y: 70, filter: 'blur(9px)' },
                      { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 9 }, 64)
        .to({}, { duration: 27 }, 73); // hold to the end of the pin

      /* ----- manifesto: scattered words assemble ----- */
      var vw = window.innerWidth, vh2 = window.innerHeight;
      manifestoWords.forEach(function (w, i) {
        var rng = mulberry32((i + 7) * 1013904223);
        gsap.set(w, {
          x: (rng() - 0.5) * vw * 0.85,
          y: (rng() - 0.5) * vh2 * 0.8,
          rotation: (rng() - 0.5) * 36,
          opacity: 0.14,
          filter: 'blur(7px)'
        });
      });
      var mtl = gsap.timeline({
        scrollTrigger: {
          trigger: '.manifesto',
          start: 'top top',
          end: 'bottom bottom',
          scrub: true
        }
      });
      mtl.to(manifestoWords, {
        x: 0, y: 0, rotation: 0, opacity: 1, filter: 'blur(0px)',
        ease: 'power2.out',
        duration: 62,
        stagger: { each: 26 / manifestoWords.length, from: 'random' }
      }, 0)
      .to({}, { duration: 26 }, 74); // settle time before the section unpins

      /* ----- rails: only over the hero ----- */
      gsap.to('.rail-top-right, .rail-mid-right, .rail-bottom-right', {
        autoAlpha: 0, duration: 0.4, ease: 'none',
        scrollTrigger: {
          trigger: '.manifesto',
          start: 'top 65%',
          toggleActions: 'play none none reverse'
        }
      });

      /* ----- work rows ----- */
      gsap.utils.toArray('.work-row').forEach(function (row) {
        gsap.fromTo(row, { y: 46, autoAlpha: 0 }, {
          y: 0, autoAlpha: 1, duration: 0.9, ease: 'power3.out',
          scrollTrigger: { trigger: row, start: 'top 88%' }
        });
      });
      gsap.fromTo('.work-head', { y: 40, autoAlpha: 0 }, {
        y: 0, autoAlpha: 1, duration: 0.9, ease: 'power3.out',
        scrollTrigger: { trigger: '.work-head', start: 'top 85%' }
      });

      /* ----- contact reveal ----- */
      gsap.fromTo('.contact-title, .contact-email, .contact-links',
        { y: 44, autoAlpha: 0 },
        {
          y: 0, autoAlpha: 1, duration: 1, ease: 'power3.out', stagger: 0.08,
          scrollTrigger: { trigger: '.contact', start: 'top 70%' }
        });

      /* ----- intro reveal (once, on load at top) ----- */
      if (window.scrollY < 40) {
        var intro = gsap.timeline({ delay: 0.15 });
        intro.fromTo('#heroCanvas', { autoAlpha: 0 }, { autoAlpha: 1, duration: 1.4, ease: 'power2.out' }, 0)
          .fromTo('.hero-headline[data-headline="0"] .eyebrow, .hero-headline[data-headline="0"] h1, .hero-headline[data-headline="0"] .hero-sub',
            { y: 42, autoAlpha: 0 },
            { y: 0, autoAlpha: 1, duration: 1, ease: 'power3.out', stagger: 0.1 }, 0.2)
          .fromTo('.rail, .hero-foot, .site-chrome',
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: 0.9, ease: 'power2.out', stagger: 0.06 }, 0.5);
      }
    });

    ScrollTrigger.refresh();
  }

  function tickLenis(time) {
    if (lenis) lenis.raf(time * 1000);
  }

  function teardownMotion() {
    if (ctx) { ctx.revert(); ctx = null; }
    if (lenis) { lenis.destroy(); lenis = null; }
    gsap.ticker.remove(tickLenis);
    document.documentElement.classList.add('no-motion');
    heroFX.setStatic(true);
    // with animations reverted, make sure the intro headline is shown
    gsap.set('.hero-headline[data-headline="0"]', { clearProps: 'all' });
  }

  /* ============================================================
     Motion toggle (the pill, like the reference)
     ============================================================ */
  var toggle = document.getElementById('motionToggle');
  function applyMotionState() {
    toggle.setAttribute('aria-checked', motionOn ? 'true' : 'false');
    if (motionOn) initMotion(); else teardownMotion();
  }
  toggle.addEventListener('click', function () {
    motionOn = !motionOn;
    applyMotionState();
  });

  /* ============================================================
     Nav — active states + anchored scrolling
     ============================================================ */
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.pill-nav a'));
  function setActive(hash) {
    navLinks.forEach(function (a) {
      a.classList.toggle('is-active', a.getAttribute('href') === hash);
    });
  }
  [['#top', '.hero'], ['#about', '.manifesto'], ['#contact', '.contact']]
    .forEach(function (pair) {
      ScrollTrigger.create({
        trigger: pair[1],
        start: 'top 45%',
        end: 'bottom 45%',
        onToggle: function (self) { if (self.isActive) setActive(pair[0]); }
      });
    });

  document.querySelectorAll('[data-nav]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var hash = a.getAttribute('href');
      var target = hash === '#top' ? document.body : document.querySelector(hash);
      if (!target) return;
      e.preventDefault();
      if (lenis) {
        lenis.scrollTo(hash === '#top' ? 0 : target, { duration: 1.4 });
      } else {
        (hash === '#top' ? document.documentElement : target)
          .scrollIntoView({ behavior: 'auto' });
      }
    });
  });

  /* ============================================================
     Boot
     ============================================================ */
  applyMotionState();
})();
