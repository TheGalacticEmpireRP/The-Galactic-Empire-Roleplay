# Free Imperial Support hosting

This is the complete Galactic Empire support portal prepared for Cloudflare Pages. It offers Careers, Staff & Member reports, General Support and Appeals, category welcome messages, guided forms, private receipts, member/staff conversations, evidence, status history, assignment, private notes, feedback and owner-managed staff roles.

The proposed free address is **https://tge-support.pages.dev**, subject to availability. The name is selected when creating the Pages project. A custom domain is optional. Deployment never changes the existing website links automatically.

## Publish from GitHub

1. Create or sign in to your [Cloudflare account](https://dash.cloudflare.com/sign-up). Keep Workers/Pages and D1 on their free plans.
2. Create a [Cloudflare API token](https://dash.cloudflare.com/profile/api-tokens) restricted to your account with **Cloudflare Pages: Edit** and **D1: Edit**. Copy your account ID from the dashboard. Do not post the token in chat or commit it to code.
3. In this repository's **Settings → Secrets and variables → Actions**, add these repository secrets:

   | Secret | Value |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | Your restricted Cloudflare token |
   | `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account's 32-character ID |
   | `SUPPORT_OWNER_EMAIL` | Your email for verified staff sign-in |

4. Open **Actions → Deploy Imperial Support to Cloudflare → Run workflow**. Use `tge-support` as the project name, or another available branded name. The workflow tests and builds the portal, provisions D1, applies migrations, deploys Pages and checks that anonymous visitors cannot reach the staff queue. The run summary contains the actual published address.
5. Complete staff sign-in below before sending members to the new portal. Member tickets use their private reference/key and need no account. **Saved tickets** is an explicit option to store private receipts on your own device; downloaded receipts work across devices.

## Secure staff sign-in

The portal requires both a cryptographically verified **Cloudflare Access** token and an authorized email in the support roster. Setting an email header grants no access. Staff access remains closed until Access is configured.

1. Set up Cloudflare Zero Trust with its free plan and a team name. Enable email **One-time PIN** as the login method, or use an existing identity provider.
2. In the Pages project, enable its preview Access policy. Open **Manage** on the generated application. Follow Cloudflare's [Pages Access instructions](https://developers.cloudflare.com/pages/platform/known-issues/#enable-access-on-your-pagesdev-domain) to remove the wildcard from its public hostname. Set the hostname to your actual production hostname and the path to **`/staff`**. Keep the public portal at `/` open. Use only the production staff application audience for this portal.
3. Set an **Allow** policy that includes your exact owner email. Use the default cookie path `/` so the staff session can accompany API requests. Add reviewers' exact emails to the policy when you add them to the roster. Do not use an Everyone or Bypass policy.
4. Copy the application's **AUD** tag. In GitHub **Actions variables**, add `CLOUDFLARE_ACCESS_TEAM` (only the team name) and `CLOUDFLARE_ACCESS_AUD` (the AUD tag). Rerun the deploy workflow with the **same project name**.
5. Open `<published address>/staff`, verify your email, and confirm owner access. Add reviewers under **Staff access** and include their emails in the Access policy. Support agents see Careers/General Support; investigators see Reports/Appeals; administrators see all categories. Only the owner manages the roster. Revocation is checked on every API request.

Public API routes are protected inside the Worker and return 403 to unauthorized staff requests. Access gates the staff page. Preview deployments are given no production database binding.

## Move existing records and switch the website

The current public portal remains at https://tge-support.gonzalezsuarezalejan.chatgpt.site until this process is verified.

1. Verify the new public categories and owner sign-in. Briefly pause writes on the original portal before taking the final export, so replies are not split between two databases.
2. Export complete `tickets`, `messages`, `events`, `attachments` and `staff` rows from the original portal, with no truncated values. Keep the JSON private. Format: `{ "format": "tge-support-backup-v1", "complete": true, "tables": { "tickets": [], "messages": [], "events": [], "attachments": [], "staff": [] } }`.
3. From a trusted computer in this directory, run `npm ci`, `npm run build`, and `npm run prepare:cloudflare` with the same account/token, owner email and project settings in your environment. Then run `node scripts/import-backup.mjs /absolute/path/tge-support.private.json`. Import preserves references, key hashes, conversations and history, then verifies each record. Staff identities are rebound after verified Cloudflare sign-in. Previous ChatGPT account linking cannot authorize Cloudflare users; those members use their original receipt keys.
4. This record-only import refuses backups containing screenshots or pending image uploads. Transfer and verify those bytes separately before cutover. The original portal must stay available if any record or image has not been verified.
5. Check an original ticket with its reference/key and check the staff queue. Update `index.html`, `support.html` and `SUPPORT_SETUP.md` in the main website repository to the **verified production address**, preserving category query links. Publish a forwarding notice on the original portal for existing receipt holders.

Do not upload private database backups to this public repository or GitHub Actions artifacts.

## Free capacity and upkeep

- Pages static assets are served directly. Only API requests and the staff page invoke the Worker.
- D1 stores both tickets and private screenshot chunks; this package requires no R2 enrollment. Each image is limited to 8 MB and each ticket to five images. Images use 256 KiB chunks, below D1 row limits. Storage reservations are atomic and uploads roll back on failure.
- The package caps screenshot bytes at 400 MiB to leave space within the free single-database limit. Indexes/metadata also use space, so monitor actual D1 storage. If the cap is reached, members can still submit ticket text and HTTPS evidence links. Cloudflare free request/database quotas still apply; this is not unlimited hosting.
- Replies appear in ticket conversations. Email and Discord notifications are not configured. Records are retained after closure; use General Support for privacy requests.
- Repeated deployment reuses the same project/database and applies only pending migrations. The request-limit salt rotates on deployment. Ticket keys and records are preserved.

## Development checks

Use Node 24. Run `npm ci`, `npm run check`, `npm test`, then `npm run build`. Output is `dist/`, including the advanced-mode `_worker.js` and routing/security headers. `wrangler.json` and `.cloudflare/` are generated and ignored. Credentials, owner email and the rate-limit salt are never written to the repository.
