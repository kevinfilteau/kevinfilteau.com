/* Shared by every page: reveal the contact details, drive the booking form.
   Loaded with defer, so the page is parsed before it runs. */
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
})();

/* The booking form: one step at a time, answers kept in sessionStorage so a
   refresh or a cancelled payment does not empty it, then Stripe Checkout. */
(function () {
    var form = document.getElementById('book');
    if (!form) return;

    var steps = Array.prototype.slice.call(form.querySelectorAll('.step'));
    var error = form.querySelector('.form-error');
    var key = 'book';

    function answers() {
        var data = new FormData(form);
        return {
            business: data.get('business') || '',
            size: data.get('size') || '',
            challenges: data.getAll('challenges'),
            other: data.get('other') || '',
            name: data.get('name') || '',
            email: data.get('email') || ''
        };
    }

    function save() {
        try { sessionStorage.setItem(key, JSON.stringify(answers())); } catch (err) {}
    }

    function restore() {
        var saved;
        try { saved = JSON.parse(sessionStorage.getItem(key)); } catch (err) {}
        if (!saved) return;
        ['business', 'other', 'name', 'email'].forEach(function (n) {
            if (form.elements[n]) form.elements[n].value = saved[n] || '';
        });
        form.querySelectorAll('input[name="size"]').forEach(function (r) { r.checked = r.value === saved.size; });
        form.querySelectorAll('input[name="challenges"]').forEach(function (c) { c.checked = (saved.challenges || []).indexOf(c.value) !== -1; });
    }

    // The label text of a checked option, so the summary shows what the visitor read.
    function chosen(name) {
        return Array.prototype.map.call(form.querySelectorAll('input[name="' + name + '"]:checked'), function (i) {
            return i.parentNode.textContent.trim();
        });
    }

    function summarize() {
        var a = answers();
        var fill = { business: a.business, size: chosen('size').join(''), challenges: chosen('challenges').join('\n'), other: a.other };
        Object.keys(fill).forEach(function (k) {
            var dd = form.querySelector('[data-summary="' + k + '"]');
            if (!dd) return;
            dd.textContent = fill[k];
            dd.previousElementSibling.hidden = dd.hidden = !fill[k];
        });
    }

    function valid(step) {
        var fields = step.querySelectorAll('input, textarea');
        for (var i = 0; i < fields.length; i++) {
            if (!fields[i].reportValidity()) return false;
        }
        var group = step.querySelector('.choices[data-required]');
        if (group && !group.querySelector('input:checked')) {
            group.querySelector('input').setCustomValidity(group.dataset.required);
            group.querySelector('input').reportValidity();
            group.querySelector('input').setCustomValidity('');
            return false;
        }
        return true;
    }

    function show(n) {
        steps.forEach(function (s, i) { s.hidden = i !== n; });
        if (n === steps.length - 1) summarize();
        error.hidden = true;
        window.scrollTo({ top: 0 });
        steps[n].querySelector('h2, h1').focus();
    }

    form.addEventListener('input', save);

    form.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-go]');
        if (!btn) return;
        var current = steps.indexOf(btn.closest('.step'));
        var next = btn.dataset.go === 'next' ? current + 1 : current - 1;
        if (next > current && !valid(steps[current])) return;
        show(next);
    });

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        var last = steps[steps.length - 1];
        if (!valid(last)) return;
        var submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        error.hidden = true;
        fetch('/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(answers())
        }).then(function (res) {
            return res.json().then(function (body) {
                if (!res.ok || !body.url) throw new Error('checkout ' + res.status + ' ' + (body.error || ''));
                location.assign(body.url);
            });
        }).catch(function (err) {
            console.error('checkout failed: ' + err.message);
            error.hidden = false;
            submit.disabled = false;
        });
    });

    restore();
    show(0);
})();

/* Voice input: record from the microphone, send the audio to /api/transcribe,
   put the text in the field named by data-record. Text stays the fallback:
   the control only shows when the browser can record. */
(function () {
    var box = document.querySelector('[data-record]');
    if (!box || !navigator.mediaDevices || !window.MediaRecorder) return;

    var field = document.getElementById(box.dataset.record);
    var wrap = box.querySelector('.record');
    var toggle = wrap.querySelector('.record-toggle');
    var status = wrap.querySelector('.record-status');
    var MAX_SECONDS = 180;
    var recorder, chunks, startedAt, ticker;

    var MIME = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].filter(function (t) {
        return MediaRecorder.isTypeSupported(t);
    })[0];

    function say(text, isError) {
        status.textContent = text;
        status.classList.toggle('error', !!isError);
    }

    function clock() {
        var s = Math.floor((Date.now() - startedAt) / 1000);
        say(Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2));
        if (s >= MAX_SECONDS) stop();
    }

    function stop() {
        if (recorder && recorder.state !== 'inactive') recorder.stop();
    }

    function transcribe(blob) {
        toggle.disabled = true;
        say('Transcription en cours…');
        fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob })
            .then(function (res) {
                return res.json().then(function (body) {
                    if (!res.ok || typeof body.text !== 'string') throw new Error('transcribe ' + res.status + ' ' + (body.error || ''));
                    field.value = (field.value.trim() ? field.value.trim() + '\n' : '') + body.text.trim();
                    field.value = field.value.slice(0, field.maxLength > 0 ? field.maxLength : undefined);
                    field.dispatchEvent(new Event('input', { bubbles: true }));
                    say('');
                });
            })
            .catch(function (err) {
                console.error('transcription failed: ' + err.message);
                say('La transcription n’a pas fonctionné. Écrivez votre réponse à la place.', true);
            })
            .then(function () { toggle.disabled = false; });
    }

    function start() {
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
            chunks = [];
            recorder = new MediaRecorder(stream, MIME ? { mimeType: MIME } : undefined);
            recorder.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
            recorder.onstop = function () {
                stream.getTracks().forEach(function (t) { t.stop(); });
                clearInterval(ticker);
                toggle.textContent = toggle.dataset.start;
                toggle.setAttribute('aria-pressed', 'false');
                transcribe(new Blob(chunks, { type: recorder.mimeType }));
            };
            recorder.start();
            startedAt = Date.now();
            ticker = setInterval(clock, 500);
            clock();
            toggle.textContent = toggle.dataset.stop;
            toggle.setAttribute('aria-pressed', 'true');
        }).catch(function (err) {
            console.error('microphone unavailable: ' + err.name);
            say('Le micro n’est pas accessible. Écrivez votre réponse à la place.', true);
        });
    }

    toggle.addEventListener('click', function () {
        if (recorder && recorder.state === 'recording') stop(); else start();
    });

    // Show the control only once the transcription engine is configured.
    fetch('/api/transcribe').then(function (res) { wrap.hidden = !res.ok; }).catch(function () {});
})();
