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
    // The real widget only answers on kevinfilteau.com; Cloudflare's test key always passes.
    var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    var sitekey = local ? '1x00000000000000000000AA' : box.dataset.sitekey;

    function settle(t) { waiters.splice(0).forEach(function (w) { w(t); }); }

    function render() {
        if (!window.turnstile) { setTimeout(render, 100); return; }
        widget = turnstile.render(box, {
            sitekey: sitekey,
            appearance: 'interaction-only',
            callback: function (t) { token = t; settle(t); },
            'expired-callback': function () { token = null; turnstile.reset(widget); },
            'error-callback': function () { token = null; settle(null); }
        });
    }
    render();

    // Resolves with a fresh token, then the caller runs and the widget is reset.
    // Fails after 20 seconds, so a broken widget shows an error instead of a spinner forever.
    return function (run) {
        var take = token ? Promise.resolve(token) : new Promise(function (resolve) {
            waiters.push(resolve);
            setTimeout(function () { resolve(null); }, 20000);
        });
        token = null;
        return take.then(function (t) {
            if (!t) throw new Error('verification');
            return run(t);
        }).finally(function () { if (widget !== null) turnstile.reset(widget); });
    };
})();

/* After a payment the booking is done: forget it in this browser. */
if (document.querySelector('[data-clear-booking]')) {
    try { sessionStorage.removeItem('book'); } catch (err) {}
}

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
    var state = { contact: {}, messages: [], summary: null };
    var TEXT = {
        chat: 'L’assistant n’a pas répondu. Réessayez dans un instant.',
        verification: 'La vérification a échoué. Rechargez la page.',
        empty: 'Écrivez une réponse d’abord.'
    };

    try { state = JSON.parse(sessionStorage.getItem(key)) || state; } catch (err) {}
    // A question that never got its answer (reload mid-flight) must not linger: the next
    // one would follow it and the transcript would no longer alternate.
    if (state.messages.length % 2 === 1) state.messages.pop();
    function save() {
        try { sessionStorage.setItem(key, JSON.stringify(state)); } catch (err) {}
    }

    var CONTACT = ['name', 'company', 'email', 'phone', 'channel'];
    function readContact() {
        var data = new FormData(form);
        CONTACT.forEach(function (k) { state.contact[k] = data.get(k) || ''; });
        save();
    }
    function restoreContact() {
        var c = state.contact || {};
        ['name', 'company', 'email', 'phone'].forEach(function (k) { if (form.elements[k]) form.elements[k].value = c[k] || ''; });
        form.querySelectorAll('input[name="channel"]').forEach(function (r) { r.checked = r.value === c.channel; });
    }
    form.addEventListener('input', readContact);

    // Reads the label of a summary value from the page's own vocabulary.
    var LABELS = {
        size: { solo: 'Moi seulement', '2-10': '2 à 10 personnes', '11-50': '11 à 50 personnes', '51-200': '51 à 200 personnes', '200+': 'Plus de 200 personnes' },
        challenges: { fit: 'Le logiciel ne suit plus la façon de travailler', stuck: 'Un projet est bloqué ou en retard', integration: 'Des systèmes qui ne se parlent pas', 'build-buy': 'Bâtir ou acheter', choice: 'Choisir une technologie ou un fournisseur', cloud: 'Couts, sécurité ou fiabilité du nuage', 'no-tech-lead': 'Personne de technique pour décider', other: 'Autre chose' }
    };

    function summarize() {
        var s = state.summary || {};
        var c = state.contact || {};
        var fill = { contact: [c.name, c.company].filter(Boolean).join('\n'), business: s.business, size: LABELS.size[s.size] || '', challenges: (s.challenges || []).map(function (c) { return LABELS.challenges[c] || c; }).join('\n'), situation: s.situation, focus: s.focus };
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

    var CHAT = 1;

    function fail(step, text) {
        var el = step.querySelector('.form-error');
        el.textContent = text || el.textContent;
        el.hidden = false;
    }

    function ask(text) {
        text = (text || '').trim();
        if (!text) { fail(steps[CHAT], TEXT.empty); return; }
        var step = steps[CHAT];
        step.querySelector('.form-error').hidden = true;
        state.messages.push({ role: 'user', content: text });
        bubble('user', text);
        draft.value = '';
        offer([]);
        send.disabled = true;
        var pending = bubble('assistant', '…', true);
        turnstileToken(function (token) {
            return fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Turnstile-Token': token },
                body: JSON.stringify({ contact: state.contact, messages: state.messages })
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
        var group = step.querySelector('.choices[data-required]');
        if (group && !group.querySelector('input:checked')) {
            var first = group.querySelector('input');
            first.setCustomValidity(group.dataset.required);
            first.reportValidity();
            first.setCustomValidity('');
            return false;
        }
        return true;
    }

    var cancel = form.querySelector('.cancel');
    var confirm = form.querySelector('.confirm');
    var progress = form.querySelectorAll('.progress li');

    function show(n) {
        steps.forEach(function (s, i) { s.hidden = i !== n; });
        progress.forEach(function (li, i) {
            li.classList.toggle('done', i < n);
            li.classList.toggle('current', i === n);
            if (i === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
        });
        cancel.hidden = n === 0;
        state.step = n;
        save();
        if (n === CHAT) renderChat();
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
        if (next > current && (!valid(steps[current]) || (current === CHAT && !state.summary))) return;
        show(next);
    });

    // Cancel: ask first, then wipe everything this browser holds and go home.
    form.addEventListener('click', function (e) {
        if (e.target.closest('[data-cancel]')) { confirm.showModal(); return; }
        var choice = e.target.closest('[data-confirm]');
        if (!choice) return;
        confirm.close();
        if (choice.dataset.confirm !== 'yes') return;
        try { sessionStorage.removeItem(key); } catch (err) {}
        state = { contact: {}, messages: [], summary: null };
        form.reset();
        location.assign('/');
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
                body: JSON.stringify({ summary: state.summary, contact: state.contact })
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

    // Local preview only: one click fills every contact field.
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        var fill = document.createElement('button');
        fill.type = 'button';
        fill.className = 'cta secondary devfill';
        fill.textContent = 'Remplir (test)';
        fill.addEventListener('click', function () {
            form.elements.name.value = 'Anne Test';
            form.elements.company.value = 'Pneus Test inc.';
            form.elements.email.value = 'anne@example.com';
            form.elements.phone.value = '418 555-0199';
            form.querySelector('input[name="channel"][value="sms"]').checked = true;
            readContact();
        });
        document.body.appendChild(fill);
    }

    restoreContact();
    // Back to the step the visitor was on, after a refresh or a visit to the privacy page.
    var start = state.step || 0;
    if (start > CHAT && !state.summary) start = CHAT;
    show(start);
})();
