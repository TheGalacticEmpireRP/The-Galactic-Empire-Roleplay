# TGE Support integration

This change adds **Support** to the website navigation, a four-category support section, and `support.html`, which forwards visitors to the persistent support service.

Support portal: https://tge-support.gonzalezsuarezalejan.chatgpt.site
Staff console: https://tge-support.gonzalezsuarezalejan.chatgpt.site/staff

## Launch sequence

1. Review the private portal. Test one member ticket and the staff dashboard.
2. Explicitly enable public visitor access on the support Site. The ticket and staff authorization checks remain in effect.
3. Merge this homepage update into the GitHub Pages branch.
4. Open the live homepage, select Support, and check all four category links plus Track a ticket.

The portal starts private. This pull request should remain a draft until public visitor access is enabled so community members are not sent to an inaccessible portal.

## Reviewer setup

The website owner opens **Staff console → Staff access** and adds each reviewer's ChatGPT account email and a display name.

- Support agent: Careers and General Support.
- Investigator: Staff & Member reports and Appeals.
- Administrator: every category.
- Only the owner manages the staff roster.

Members receive a private ticket reference and key. Signed-in members can use My tickets. Staff aliases appear in replies. Email and Discord notifications are not configured; members check their ticket for updates.

Evidence supports up to five HTTPS links and five private PNG/JPEG/WebP screenshots (8 MB each). Tickets are retained after closure, and Roblox usernames in forms are self-reported rather than authenticated Roblox identities.

## Validation

The support service's TypeScript check, production build, and 13 automated integration tests pass. They cover category messages, privacy, signed-in ownership, role restrictions, internal notes, retry handling, evidence validation, ticket workflow, feedback, access revocation, request limits, and cross-origin writes. Browser visual verification is not available in the authoring environment.
