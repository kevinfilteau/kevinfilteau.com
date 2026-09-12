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

/* Turnstile: one widget per page, one token per call to the Functions.
   A token is single-use, so the widget is reset after each call. */
var turnstileToken = (function () {
    var box = document.querySelector('.turnstile');
    if (!box) return null;
    var widget = null, token = null, waiters = [];

    function render() {
        if (!window.turnstile) { setTimeout(render, 100); return; }
        widget = turnstile.render(box, {
            sitekey: box.dataset.sitekey,
            appearance: 'interaction-only',
            callback: function (t) { token = t; waiters.splice(0).forEach(function (w) { w(t); }); },
            'expired-callback': function () { token = null; turnstile.reset(widget); },
            'error-callback': function () { token = null; }
        });
    }
    render();

    // Resolves with a fresh token, then the caller runs and the widget is reset.
    return function (run) {
        var take = token ? Promise.resolve(token) : new Promise(function (resolve) { waiters.push(resolve); });
        token = null;
        return take.then(run).finally(function () { if (widget !== null) turnstile.reset(widget); });
    };
})();

/* The booking form: a fixed first step, the assistant chat, then review and pay.
   The transcript and the summary live in sessionStorage so a refresh or a
   cancelled payment does not empty them. */
(function () {
    var form = document.getElementById('book');
    if (!form) return;

    var steps = Array.prototype.slice.call(form.querySelectorAll('.step'));
    var key = 'book';
    var chat = form.querySelector('.chat');
    var chips = form.querySelector('.chips');
    var composer = form.querySelector('.composer');
    var draft = form.querySelector('#draft');
    var card = form.querySelector('.card');
    var send = form.querySelector('[data-chat="send"]');
    var state = { messages: [], summary: null };
    var TEXT = {
        chat: 'L’assistant n’a pas répondu. Réessayez dans un instant.',
        verification: 'La vérification a échoué. Rechargez la page.',
        empty: 'Écrivez une réponse d’abord.'
    };

    try { state = JSON.parse(sessionStorage.getItem(key)) || state; } catch (err) {}
    function save() {
        try { sessionStorage.setItem(key, JSON.stringify(state)); } catch (err) {}
    }

    // Reads the label of a summary value from the page's own vocabulary.
    var LABELS = {
        size: { solo: 'Moi seulement', '2-10': '2 à 10 personnes', '11-50': '11 à 50 personnes', '51-200': '51 à 200 personnes', '200+': 'Plus de 200 personnes' },
        challenges: { fit: 'Le logiciel ne suit plus la façon de travailler', stuck: 'Un projet est bloqué ou en retard', integration: 'Des systèmes qui ne se parlent pas', 'build-buy': 'Bâtir ou acheter', choice: 'Choisir une technologie ou un fournisseur', cloud: 'Couts, sécurité ou fiabilité du nuage', 'no-tech-lead': 'Personne de technique pour décider', other: 'Autre chose' }
    };

    function summarize() {
        var s = state.summary || {};
        var fill = { business: s.business, size: LABELS.size[s.size] || '', challenges: (s.challenges || []).map(function (c) { return LABELS.challenges[c] || c; }).join('\n'), situation: s.situation, focus: s.focus };
        form.querySelectorAll('[data-summary]').forEach(function (dd) {
            var v = fill[dd.dataset.summary] || '';
            dd.textContent = v;
            dd.previousElementSibling.hidden = dd.hidden = !v;
        });
    }

    function bubble(role, text, pending) {
        var el = document.createElement('div');
        el.className = 'bubble ' + role + (pending ? ' pending' : '');
        el.textContent = text;
        chat.appendChild(el);
        el.scrollIntoView({ block: 'nearest' });
        return el;
    }

    function offer(choices) {
        chips.textContent = '';
        (choices || []).forEach(function (c) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'cta secondary';
            b.textContent = c;
            b.addEventListener('click', function () { ask(c); });
            chips.appendChild(b);
        });
    }

    function renderChat() {
        chat.textContent = '';
        bubble('assistant', chat.dataset.intro);
        state.messages.forEach(function (m) { bubble(m.role, m.content); });
        var done = !!state.summary;
        composer.hidden = done;
        card.hidden = !done;
        if (done) { summarize(); offer([]); }
    }

    function fail(step, text) {
        var el = step.querySelector('.form-error');
        el.textContent = text || el.textContent;
        el.hidden = false;
    }

    function ask(text) {
        text = (text || '').trim();
        if (!text) { fail(steps[1], TEXT.empty); return; }
        var step = steps[1];
        step.querySelector('.form-error').hidden = true;
        state.messages.push({ role: 'user', content: text });
        save();
        bubble('user', text);
        draft.value = '';
        offer([]);
        send.disabled = true;
        var pending = bubble('assistant', '…', true);
        turnstileToken(function (token) {
            return fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Turnstile-Token': token },
                body: JSON.stringify({ messages: state.messages })
            });
        }).then(function (res) {
            return res.json().then(function (body) {
                if (!res.ok) throw new Error(body.error || String(res.status));
                pending.remove();
                state.messages.push({ role: 'assistant', content: body.reply });
                state.summary = body.done ? body.summary : null;
                save();
                bubble('assistant', body.reply);
                offer(body.choices);
                if (body.done) { composer.hidden = true; card.hidden = false; summarize(); card.scrollIntoView({ block: 'nearest' }); }
            });
        }).catch(function (err) {
            console.error('chat failed: ' + err.message);
            pending.remove();
            state.messages.pop();
            save();
            draft.value = text;
            fail(step, err.message === 'verification' ? TEXT.verification : TEXT.chat);
        }).then(function () { send.disabled = false; });
    }

    function valid(step) {
        var fields = step.querySelectorAll('input');
        for (var i = 0; i < fields.length; i++) {
            if (!fields[i].reportValidity()) return false;
        }
        return true;
    }

    function show(n) {
        steps.forEach(function (s, i) { s.hidden = i !== n; });
        if (n === 1) renderChat();
        if (n === steps.length - 1) summarize();
        var error = steps[n].querySelector('.form-error');
        if (error) error.hidden = true;
        window.scrollTo({ top: 0 });
        steps[n].querySelector('h2, h1').focus();
    }

    form.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-go], [data-chat]');
        if (!btn) return;
        if (btn.dataset.chat === 'send') { ask(draft.value); return; }
        if (btn.dataset.chat === 'refine') { state.summary = null; save(); card.hidden = true; composer.hidden = false; draft.focus(); return; }
        var current = steps.indexOf(btn.closest('.step'));
        var next = btn.dataset.go === 'next' ? current + 1 : current - 1;
        if (next > current && (!valid(steps[current]) || (current === 1 && !state.summary))) return;
        show(next);
    });

    draft.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(draft.value); }
    });

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        var last = steps[steps.length - 1];
        if (!valid(last) || !state.summary) return;
        var submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        last.querySelector('.form-error').hidden = true;
        turnstileToken(function (token) {
            return fetch('/api/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Turnstile-Token': token },
                body: JSON.stringify({ summary: state.summary, name: form.elements.name.value, email: form.elements.email.value })
            });
        }).then(function (res) {
            return res.json().then(function (body) {
                if (!res.ok || !body.url) throw new Error('checkout ' + res.status + ' ' + (body.error || ''));
                location.assign(body.url);
            });
        }).catch(function (err) {
            console.error('checkout failed: ' + err.message);
            fail(last);
            submit.disabled = false;
        });
    });

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
        turnstileToken(function (token) {
            return fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': blob.type, 'X-Turnstile-Token': token }, body: blob });
        }).then(function (res) {
            return res.json().then(function (body) {
                if (!res.ok || typeof body.text !== 'string') throw new Error('transcribe ' + res.status + ' ' + (body.error || ''));
                field.value = ((field.value.trim() ? field.value.trim() + '\n' : '') + body.text.trim()).slice(0, field.maxLength > 0 ? field.maxLength : undefined);
                field.focus();
                say('');
            });
        }).catch(function (err) {
            console.error('transcription failed: ' + err.message);
            say('La transcription n’a pas fonctionné. Écrivez votre réponse à la place.', true);
        }).then(function () { toggle.disabled = false; });
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
