// Replace these two values before publishing if you have not already.
const LINKS = {
  discord: "https://discord.gg/esWScG4bxZ",
  roblox: "https://www.roblox.com/communities/320324404/TGE-The-GaIactic-Emp-re#!/about"
};

document.querySelectorAll('.discord-link').forEach(a => a.href = LINKS.discord);
document.querySelectorAll('.roblox-link').forEach(a => a.href = LINKS.roblox);

// Loading screen
window.addEventListener('load', () => {
  document.body.classList.add('loading');
  setTimeout(() => {
    document.querySelector('#loader').classList.add('hidden');
    document.body.classList.remove('loading');
  }, 1900);
});

// Header state
const header = document.querySelector('.site-header');
window.addEventListener('scroll', () => header.classList.toggle('scrolled', scrollY > 30), { passive: true });

// Mobile navigation
const menu = document.querySelector('.menu-toggle');
const nav = document.querySelector('.nav-links');
menu.addEventListener('click', () => nav.classList.toggle('open'));
nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => nav.classList.remove('open')));

// Scroll reveal
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12, rootMargin: '0px 0px -30px 0px' });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

// Custom cursor
const dot = document.querySelector('.cursor-dot');
const ring = document.querySelector('.cursor-ring');
let mouseX = innerWidth / 2, mouseY = innerHeight / 2;
let ringX = mouseX, ringY = mouseY;
window.addEventListener('mousemove', e => {
  mouseX = e.clientX; mouseY = e.clientY;
  dot.style.left = mouseX + 'px'; dot.style.top = mouseY + 'px';
});
function animateCursor() {
  ringX += (mouseX - ringX) * .16;
  ringY += (mouseY - ringY) * .16;
  ring.style.left = ringX + 'px'; ring.style.top = ringY + 'px';
  requestAnimationFrame(animateCursor);
}
animateCursor();
document.querySelectorAll('a, button, summary, .division-card').forEach(el => {
  el.addEventListener('mouseenter', () => ring.classList.add('hover'));
  el.addEventListener('mouseleave', () => ring.classList.remove('hover'));
});

// Lightweight parallax
const parallaxEls = [...document.querySelectorAll('[data-parallax]')];
let ticking = false;
function updateParallax() {
  parallaxEls.forEach(el => {
    const rect = el.parentElement.getBoundingClientRect();
    const speed = parseFloat(el.dataset.parallax || '0.1');
    const offset = (rect.top - innerHeight / 2) * speed;
    el.style.transform = `translate3d(0, ${offset}px, 0) scale(1.08)`;
  });
  ticking = false;
}
window.addEventListener('scroll', () => {
  if (!ticking) { requestAnimationFrame(updateParallax); ticking = true; }
}, { passive: true });
updateParallax();

// 3D tilt for division cards (desktop only)
document.querySelectorAll('.division-card').forEach(card => {
  card.addEventListener('mousemove', e => {
    if (innerWidth < 760) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - .5;
    const y = (e.clientY - r.top) / r.height - .5;
    card.style.transform = `perspective(900px) rotateY(${x * 3}deg) rotateX(${y * -3}deg)`;
  });
  card.addEventListener('mouseleave', () => card.style.transform = '');
});

// Prevent placeholder links from jumping until real URLs are added.
document.querySelectorAll('a[href="#"]').forEach(a => a.addEventListener('click', e => e.preventDefault()));
