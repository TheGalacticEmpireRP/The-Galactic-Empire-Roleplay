# The Galactic Empire — Roblox Roleplay Website

The public TGE community website is a buildless HTML, CSS, and JavaScript site hosted with GitHub Pages:

https://thegalacticempirerp.github.io/The-Galactic-Empire-Roleplay/

## Website files

- `index.html`: navigation, featured experience, community dispatches, divisions, leadership, support links, member guide, and footer.
- `style.css`: responsive dark layout, red TGE accents, hover and focus states, and reduced-motion support.
- `script.js`: mobile navigation, active section highlighting, and local keyboard-accessible search (`Ctrl+K` / `⌘K`).
- `assets/`: existing TGE artwork and favicon.
- `support.html`: compatibility shortcut to `https://tge-support.pages.dev/`, preserving supported category and tracking parameters.

The homepage uses the existing community and founder links directly in HTML, so navigation does not depend on JavaScript. Google Fonts supplies Inter and Oswald with local font fallbacks. Search operates within the public site and does not send queries to a server.

## Publishing

GitHub Pages publishes the `main` branch from the repository root. Keep assets and relative paths together. The website has no package installation or build step.

The separate `cloudflare-support/` application and its workflows are documented in `SUPPORT_SETUP.md` and that application's README. Homepage styling does not change the support application's ticket data or staff configuration.
