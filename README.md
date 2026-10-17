# The Galactic Empire — Roblox Roleplay Website

The public TGE community website is a buildless HTML, CSS, and JavaScript site hosted with GitHub Pages:

https://thegalacticempirerp.github.io/The-Galactic-Empire-Roleplay/

## Website files

- `index.html`: navigation, featured experience, community dispatches, divisions, leadership, support links, member guide, and footer.
- `assets/imperial-theme.css`: shared colors, typography, and motion tokens used by both the community website and Cloudflare support.
- `style.css`: responsive layout, progressive scroll reveals, hover motion, division filters, and quick support panel styling.
- `script.js`: mobile navigation, local search (`Ctrl+K` / `⌘K`), division filtering, reduced-motion-aware animation, reading progress, and a read-only connection to the live support directory.
- `assets/`: existing TGE artwork and favicon.
- `support.html`: compatibility shortcut to `https://tge-support.pages.dev/`, preserving category, tracking, guides, and saved-ticket parameters.

The homepage uses the existing community and founder links directly in HTML, so navigation does not depend on JavaScript. Google Fonts supplies Inter and Oswald with local font fallbacks. Search operates within the public site and does not send queries to a server.

## Publishing

GitHub Pages publishes the `main` branch from the repository root. Keep assets and relative paths together. The website has no package installation or build step.

The separate `cloudflare-support/` application and its workflows are documented in `SUPPORT_SETUP.md` and that application's README. Homepage styling does not change the support application's ticket data or staff configuration.

## Cloudflare support synchronization

The website opens the existing `https://tge-support.pages.dev/` application directly. Its public `/api/support/public-info` endpoint keeps category names and descriptions aligned. Static links continue to work when the directory cannot be loaded. Only public category metadata is requested, with no cookies, ticket keys, or staff information.

Changes to `cloudflare-support/**`, `assets/imperial-theme.css`, or the support deployment workflow automatically run checks, build, and deploy the existing `tge-support` project from `main`. The workflow also remains available for manual runs. It uses the existing encrypted repository secrets and reuses the existing D1 database.
