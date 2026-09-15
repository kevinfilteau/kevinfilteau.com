// The fog over the home page. The scroll sets targets; a frame loop eases --h (headline),
// --p (fog) and --s (subheading) toward them, so the fog keeps clearing a moment after
// the scroll stops. The fog CSS waits for .fogged on <html>: without JS or with reduced
// motion the class never comes and the page renders clear.
(function () {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var CLEAR_SPEED = 1.9; // how fast the fog clears per screen of scroll
    var FOG_FLOOR = 0;     // share of the fog that never clears
    var root = document.documentElement;
    var target = null, cur = null, raf = null, last = 0;

    function onScroll() {
        var y = scrollY, vh = innerHeight;
        var t = Math.min(1, y / (vh * 1.4) * CLEAR_SPEED);
        target = { h: Math.min(1, y / (vh * 0.6)), p: (1 - Math.pow(1 - t, 3)) * (1 - FOG_FLOOR), s: y > 2 ? 1 : 0 };
        // First call starts where the page is, so a reload mid-page does not flash full fog.
        if (!cur) cur = Object.assign({}, target);
        if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
    }

    function tick(now) {
        var moving = false;
        // The ease factors are per 60 Hz frame; scale them by the real frame time,
        // so the fog clears at the same speed on a 30 Hz, 60 Hz or 120 Hz screen.
        var frames = Math.min(4, (now - last) / (1000 / 60));
        last = now;
        ['h', 'p', 's'].forEach(function (k) {
            var d = target[k] - cur[k];
            if (Math.abs(d) > 0.0008) { cur[k] += d * (1 - Math.pow(1 - (k === 's' ? 0.3 : 0.12), frames)); moving = true; }
            else cur[k] = target[k];
            root.style.setProperty('--' + k, cur[k].toFixed(4));
        });
        root.classList.toggle('clear', cur.p === 1);
        raf = moving ? requestAnimationFrame(tick) : null;
    }

    root.classList.add('fogged');
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
    onScroll();
})();
