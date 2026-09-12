// Cloudflare Turnstile check, shared by every Function that costs money to call.
// The page sends the widget token in X-Turnstile-Token; a token is single-use,
// so the page resets the widget after each call. Fails closed.
export async function verifyTurnstile(env, token, ip) {
    if (!env.TURNSTILE_SECRET_KEY || !token) return false;
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
    if (ip) body.set('remoteip', ip);
    try {
        const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
        return (await res.json()).success === true;
    } catch (err) {
        return false;
    }
}

// True when the request carries a token Cloudflare confirms.
export const human = (request, env) => verifyTurnstile(env, request.headers.get('X-Turnstile-Token'), request.headers.get('CF-Connecting-IP'));
