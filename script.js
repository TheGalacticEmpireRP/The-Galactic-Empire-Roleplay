'use strict';

// Navigation stays usable without JavaScript; enhancement adds the mobile panel.
const menuToggle = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#site-navigation');
const communityMenu = document.querySelector('.nav-dropdown');

function closeNavigation(restoreFocus = false) {
  navigation.classList.remove('is-open');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Open navigation');
  communityMenu.open = false;
  if (restoreFocus) menuToggle.focus();
}

menuToggle.addEventListener('click', () => {
  const open = menuToggle.getAttribute('aria-expanded') !== 'true';
  navigation.classList.toggle('is-open', open);
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
});
navigation.querySelectorAll('a').forEach(link => link.addEventListener('click', () => closeNavigation()));
document.addEventListener('click', event => {
  if (!document.querySelector('.site-header').contains(event.target)) closeNavigation();
  else if (!communityMenu.contains(event.target)) communityMenu.open = false;
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (communityMenu.open) {
    communityMenu.open = false;
    communityMenu.querySelector('summary').focus();
  } else if (menuToggle.getAttribute('aria-expanded') === 'true') closeNavigation(true);
});
const mobileLayout = window.matchMedia('(max-width: 800px)');
mobileLayout.addEventListener('change', () => closeNavigation());

// Highlight the current section without delaying or hiding the page content.
const navSections = { home: 'home', about: 'community', divisions: 'divisions', leadership: 'community', support: 'support', faq: 'community' };
if ('IntersectionObserver' in window) {
  const sectionObserver = new IntersectionObserver(entries => {
    const entry = entries.find(item => item.isIntersecting);
    if (!entry) return;
    const active = navSections[entry.target.id];
    document.querySelectorAll('[data-nav]').forEach(link => {
      const current = link.dataset.nav === active;
      link.classList.toggle('is-active', current);
      if (current && link.tagName === 'A') link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }, { rootMargin: '-15% 0px -65% 0px', threshold: 0 });
  Object.keys(navSections).forEach(id => sectionObserver.observe(document.getElementById(id)));
}
document.getElementById('year').textContent = new Date().getFullYear();

// Search is local to this public site. Queries are never sent to a server.
const searchDialog = document.getElementById('site-search');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const searchStatus = document.getElementById('search-status');
const searchButton = document.querySelector('.search-trigger');
const searchPages = [
  { title: 'About the Empire', type: 'Community', href: '#about', keywords: 'about join military roblox roleplay training events' },
  { title: 'Imperial divisions', type: 'Community', href: '#divisions', keywords: 'division recruitment branches tryout' },
  { title: 'Imperial leadership', type: 'Community', href: '#leadership', keywords: 'founder co-founder z4cktbh shadowflyplayzyt command' },
  { title: 'Member guide', type: 'Resources', href: '#faq', keywords: 'faq questions help experience training' },
  { title: 'Support Center', type: 'Support', href: 'support.html', keywords: 'help support ticket contact' },
  { title: 'Track a ticket', type: 'Support', href: 'support.html?view=track', keywords: 'reply receipt reference key staff message ticket' },
  { title: 'Careers', type: 'Support', href: 'support.html?category=careers', keywords: 'application hiring jobs officer staff recruitment' },
  { title: 'Staff & Member reports', type: 'Support', href: 'support.html?category=reports', keywords: 'report misconduct abuse complaint' },
  { title: 'General Support', type: 'Support', href: 'support.html?category=general', keywords: 'game bug rank progression issue help' },
  { title: 'Appeals', type: 'Support', href: 'support.html?category=appeals', keywords: 'appeal ban blacklist warning sanction review' },
  { title: 'Roblox group', type: 'On Roblox', href: document.querySelector('.nav-actions .button').href, keywords: 'join group community roblox' },
  { title: 'Experience hub', type: 'On Roblox', href: document.querySelector('.hero-actions .text-link').href, keywords: 'play game hub' },
  { title: 'Discord community', type: 'Community', href: document.querySelector('.nav-discord').href, keywords: 'discord chat community updates announcements events' }
];
document.querySelectorAll('.division-card').forEach(card => {
  searchPages.push({ title: card.querySelector('h3').textContent.replace('↗', '').trim(), type: 'Division · Roblox', href: card.href, keywords: card.querySelector('p').textContent });
});

let searchOpener = null;
let searchDestination = null;
function renderSearch() {
  const terms = searchInput.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = searchPages.filter(page => {
    const haystack = `${page.title} ${page.type} ${page.keywords}`.toLowerCase();
    return terms.every(term => haystack.includes(term));
  });
  searchResults.replaceChildren();
  searchStatus.textContent = `${matches.length} ${matches.length === 1 ? 'result' : 'results'} found.`;
  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'search-empty';
    empty.textContent = 'No results. Try “divisions”, “support”, or “careers”.';
    searchResults.append(empty);
    return;
  }
  matches.forEach(page => {
    const link = document.createElement('a');
    link.className = 'search-result';
    link.href = page.href;
    const external = /^https?:/.test(page.href);
    if (external) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    const type = document.createElement('small');
    const arrow = document.createElement('span');
    title.textContent = page.title;
    type.textContent = page.type;
    arrow.textContent = external ? '↗' : '→';
    arrow.setAttribute('aria-hidden', 'true');
    copy.append(title, type);
    link.append(copy, arrow);
    link.addEventListener('click', () => {
      searchDestination = page.href.startsWith('#') ? document.querySelector(page.href) : null;
      searchDialog.close();
    });
    searchResults.append(link);
  });
}
function openSearch() {
  if (searchDialog.open) return;
  if (typeof searchDialog.showModal !== 'function') { location.hash = 'support'; return; }
  const fromMobileNavigation = navigation.contains(document.activeElement) && mobileLayout.matches;
  searchOpener = fromMobileNavigation ? menuToggle : document.activeElement;
  searchDestination = null;
  closeNavigation();
  searchInput.value = '';
  renderSearch();
  searchDialog.showModal();
  searchInput.focus();
}
searchButton.addEventListener('click', openSearch);
searchInput.addEventListener('input', renderSearch);
document.querySelector('.search-close').addEventListener('click', () => searchDialog.close());
searchDialog.addEventListener('close', () => {
  if (searchDestination) {
    searchDestination.tabIndex = -1;
    searchDestination.focus({ preventScroll: true });
  } else if (searchOpener?.isConnected) searchOpener.focus();
});
searchDialog.addEventListener('click', event => { if (event.target === searchDialog) searchDialog.close(); });
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (searchDialog.open) searchDialog.close(); else openSearch();
  }
});
searchDialog.addEventListener('keydown', event => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
  const links = [...searchResults.querySelectorAll('a')];
  if (!links.length) return;
  const current = links.indexOf(document.activeElement);
  if (event.key === 'Enter' && document.activeElement === searchInput) {
    event.preventDefault();
    links[0].click();
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    links[(current + 1) % links.length].focus();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (current <= 0) searchInput.focus(); else links[current - 1].focus();
  }
});
if (/Mac|iPhone|iPad/.test(navigator.platform)) searchButton.querySelector('kbd').textContent = '⌘ K';
