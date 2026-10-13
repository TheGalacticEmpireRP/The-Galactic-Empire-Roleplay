# Free Imperial Support hosting

This is the complete Galactic Empire support portal prepared for Cloudflare Pages. It offers Careers, Staff & Member reports, General Support and Appeals, category welcome messages, guided forms, private receipts, member/staff conversations, evidence, status history, assignment, private notes, feedback and owner-managed staff roles.

The public free address is **https://tge-support.pages.dev**. The name is selected when creating the Pages project. A custom domain is optional. Deployment never changes the existing website links automatically.

## Publish from GitHub

1. Create or sign in to your [Cloudflare account](https://dash.cloudflare.com/sign-up). Keep Workers/Pages and D1 on their free plans.
2. Create a [Cloudflare API token](https://dash.cloudflare.com/profile/api-tokens) restricted to your account with **Cloudflare Pages: Edit** and **D1: Edit**. Copy your account ID from the dashboard. Do not post the token in chat or commit it to code.
3. In this repository's **Settings → Secrets and variables → Actions**, add these repository secrets:

   | Secret | Value |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | Your restricted Cloudflare token |
   | `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account's 32-character ID |
   | `SUPPORT_OWNER_EMAIL` | Your owner email for staff sign-in |
   | `SUPPORT_OWNER_LOGIN_CODE` | A private random code generated with `owner-code.html` |

4. Open **Actions → Deploy Imperial Support to Cloudflare → Run workflow**. Use `tge-support` as the project name, or another available branded name. The workflow tests and builds the portal, provisions D1, applies migrations and deploys Pages. It allows up to two minutes for the public page/API to become ready and checks that anonymous visitors cannot reach the staff queue. The run summary contains the actual published address.
5. Activate your owner account below before sending members to the new portal. Member tickets use their private reference/key and need no account. **Saved tickets** is an explicit option to store private receipts on your own device; downloaded receipts work across devices.

## Built-in staff sign-in

Staff sign in directly at **https://tge-support.pages.dev/staff** with their email and an individual private access code. Cloudflare Access and Zero Trust enrollment are not required. Member tickets still need no account.

### Activate your owner account

1. Download `owner-code.html` from this folder and open the file in your browser. Click **Generate owner code**, copy it and keep a private copy. Generation happens entirely on your device; the tool makes no network requests and saves nothing.
2. In GitHub **Settings → Secrets and variables → Actions → Secrets**, add **`SUPPORT_OWNER_LOGIN_CODE`** with the generated code as its value. Keep the existing `SUPPORT_OWNER_EMAIL` secret as your owner sign-in email. A code must be a generated 64-character hexadecimal value, not a human-chosen password.
3. Start a **new** deployment run on `main`, with the existing **`tge-support`** project name. The workflow seals only a hash of your code in Cloudflare, applies the additional staff tables, and keeps existing tickets intact. Owner configuration is validated before any resources are changed.
4. Open **https://tge-support.pages.dev/staff**, enter the owner email and private code, and choose **Sign in to staff console**. Confirm you have **Owner access** before switching website links.
5. If you previously enabled a Cloudflare Access application for this staff page, disable that application so the built-in sign-in page can open. The Worker itself protects every staff API request. The old `CLOUDFLARE_ACCESS_TEAM` and `CLOUDFLARE_ACCESS_AUD` variables are no longer used.

### Add and manage reviewers

- Open **Staff access**. Choose the reviewer's email, display name and role, then select **Save reviewer and create code**. Copy or download their private invitation and share it privately. Invitations are not emailed automatically.
- Codes are displayed only when generated; their plaintext is never stored on the server. **New sign-in code** replaces a lost code and signs that reviewer out on every device.
- Saving an existing reviewer replaces their code. Removing access deletes their login credential and sessions. Role changes are rechecked on every request and invalidate earlier sessions.
- Support agents see Careers and General Support; investigators see Reports and Appeals; administrators see all categories. Only the owner can manage reviewer access or issue codes.
- Sign-in creates a separate 256-bit session token in a `Secure`, `HttpOnly`, `SameSite=Strict`, host-only cookie. D1 stores only token/code hashes. Sessions expire after eight hours or 30 minutes without API activity, with at most five sessions per person. **Sign out** ends the current session; **Sign out all devices** ends every session for that person.
- Sign-in requests are rate limited by IP and email. Authentication and staff changes require a matching browser origin. Header impersonation, legacy Cloudflare identity cookies, and client-supplied roles cannot authorize access.
- To replace a lost owner code, generate a new one, update `SUPPORT_OWNER_LOGIN_CODE` and run deployment again. Existing owner sessions end; reviewers retain their own codes. The owner code is never sent to another staff member.

Public pages include no private staff data. All permissions and attachment checks remain in the Worker. Preview deployments have no production database or owner credentials.

## Move existing records and switch the website

The current public portal remains at https://tge-support.gonzalezsuarezalejan.chatgpt.site until this process is verified.

1. Verify the new public categories and owner sign-in. Briefly pause writes on the original portal before taking the final export, so replies are not split between two databases.
2. Export complete `tickets`, `messages`, `events`, `attachments` and `staff` rows from the original portal, with no truncated values. Keep the JSON private. Format: `{ "format": "tge-support-backup-v1", "complete": true, "tables": { "tickets": [], "messages": [], "events": [], "attachments": [], "staff": [] } }`.
3. From a trusted computer in this directory, run `npm ci`, `npm run build`, and `npm run prepare:cloudflare` with the same account/token, owner email, owner login code and project settings in your environment. Then run `node scripts/import-backup.mjs /absolute/path/tge-support.private.json`. Import preserves references, key hashes, conversations and history, then verifies each record. Staff identities are bound to their owner-issued sign-in codes; imported reviewers need a new code from Staff access. Previous ChatGPT account linking cannot authorize Cloudflare users; those members use their original receipt keys.
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

Use Node 24. Run `npm ci`, `npm run check`, `npm test`, `npm run build`, then `npm run test:migrations`. The migration check uses Wrangler and an isolated local D1 database with the generated Pages configuration, then verifies owner/reviewer login and revocation in the built Cloudflare Worker runtime. Deployment errors retain Wrangler diagnostics with credentials redacted. Output is `dist/`, including the advanced-mode `_worker.js` and routing/security headers. `wrangler.json` and `.cloudflare/` are generated and ignored. Credentials, owner email, owner code/hash and the rate-limit salt are never written to the repository. The offline owner-code tool contains no credential until you generate one locally.
