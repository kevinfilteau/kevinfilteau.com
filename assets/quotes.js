// Slides .quotes-track and keeps the dot-pills in sync. Prev/next wrap around.
// Arrow keys work once the carousel has been focused or hovered.
function initQuotes(root) {
    const track = root.querySelector('.quotes-track');
    const slides = [...root.querySelectorAll('.quote')];
    const dots = root.querySelector('.quotes-dots');
    if (!track || slides.length < 2 || !dots) return;

    let index = 0;

    slides.forEach((slide, i) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.setAttribute('role', 'tab');
        dot.setAttribute('aria-label', `Situation ${i + 1} sur ${slides.length}`);
        dot.addEventListener('click', () => show(i));
        dots.append(dot);
    });

    function show(n) {
        index = (n + slides.length) % slides.length;
        track.style.transform = `translateX(${-index * 100}%)`;
        [...dots.children].forEach((dot, i) =>
            dot.setAttribute('aria-selected', String(i === index)));
        slides.forEach((slide, i) => {
            // keep offscreen quotes out of the tab order and the a11y tree
            slide.inert = i !== index;
            slide.setAttribute('aria-hidden', String(i !== index));
        });
    }

    root.querySelector('.quotes-prev')?.addEventListener('click', () => show(index - 1));
    root.querySelector('.quotes-next')?.addEventListener('click', () => show(index + 1));

    root.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
    });

    show(0);
}

document.querySelectorAll('.quotes').forEach(initQuotes);
