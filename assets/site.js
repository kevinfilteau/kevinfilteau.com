/* Shared by every page: reveal the contact details, remember the language choice.
   Loaded with defer, so the page is parsed before it runs.
   The language redirect is not here — it is per page and must run before the paint. */
(function () {
    var e = document.getElementById('email-link');
    if (e) {
        var addr = e.dataset.u + '@' + e.dataset.d;
        var a = document.createElement('a');
        a.href = 'mailto:' + addr;
        a.textContent = addr;
        e.replaceWith(a);
    }

    var p = document.getElementById('phone-link');
    if (p) {
        var a1 = p.dataset.a, a2 = p.dataset.b, a3 = p.dataset.c;
        var raw = a1 + a2 + a3;
        var pretty = '+' + raw[0] + ' ' + raw.slice(1, 4) + '-' + a2 + '-' + a3;
        var t = document.createElement('a');
        t.href = 'tel:+' + raw;
        t.textContent = pretty;
        p.replaceWith(t);
    }

    document.querySelectorAll('.lang-switcher a').forEach(function (link) {
        link.addEventListener('click', function () {
            try { localStorage.setItem('lang', link.dataset.lang); } catch (err) {}
        });
    });
})();
