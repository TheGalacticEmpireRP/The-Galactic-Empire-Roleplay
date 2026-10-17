# Send TGE support alerts from Gmail without buying a domain

This option uses a small Google Apps Script web app owned by your dedicated TGE Gmail account. It sends the same confirmation emails and staff-reply alerts as the Resend integration. The support website keeps its current `pages.dev` address.

The code is ready, but the Gmail account owner must authorize the sender and deploy the Google web app before delivery can work. A Gmail address alone does not connect the account. No password or Gmail sign-in code belongs in GitHub secrets or chat.

## 1. Create the sender in your dedicated Gmail account

1. Sign in to [Google Apps Script](https://script.google.com/) with the Gmail account you want members to see as the sender. Create a **New project** and name it **TGE Gmail Notifications**.
2. Replace the default contents of **Code.gs** with [GmailSender.gs](google-apps-script/GmailSender.gs) from this repository. Save the project.
3. Open **Project Settings**, enable **Show appsscript.json manifest file in editor**, then replace that file with [appsscript.json](google-apps-script/appsscript.json). Its permissions are limited to sending email and identifying the account running the script. It cannot read your Gmail inbox.

## 2. Set the private sender key

Download [generate-secret.html](google-apps-script/generate-secret.html) and open it locally. Click **Generate a new sender key**. The page runs offline and saves nothing. Keep the generated key private; this is a new sender key, separate from the owner login code you already use for the staff console.

In Apps Script **Project Settings → Script properties**, add:

| Property | Value |
| --- | --- |
| `TGE_SENDER_EMAIL` | The dedicated Gmail account running this project |
| `TGE_EMAIL_SECRET` | The new 64-character key from the offline generator |

Select **Save script properties**. In the editor, choose **authorizeSender** and select **Run**. Review Google's authorization request for the project you just created and authorize it with the same dedicated Gmail account. This checks the sender and its available sending quota; it does not send a test email. If Google asks for permissions beyond sending email and identifying the sender account, stop and check the source and manifest.

## 3. Deploy the Google web app

Select **Deploy → New deployment → Select type → Web app**:

| Setting | Value |
| --- | --- |
| Description | `TGE support email sender` |
| Execute as | **Me**, showing your dedicated TGE Gmail account |
| Who has access | **Anyone** |

Deploy and copy the **Web app URL**, ending in `/exec`. Do not use the editor URL or the `/dev` test URL. A public web app URL is necessary for the Cloudflare server to reach it. Sending still requires a valid signed request using the private key; anonymous visitors cannot send email. Keep the project itself private and do not share its edit access.

## 4. Connect it to the support website

In the GitHub repository, open **Settings → Secrets and variables → Actions**. Set:

| GitHub secret | Value |
| --- | --- |
| `SUPPORT_EMAIL_FROM` | `TGE Support <your-tge-account@gmail.com>`, using the same account as `TGE_SENDER_EMAIL` |
| `GMAIL_SENDER_URL` | The Google Web app URL ending in `/exec` |
| `GMAIL_SENDER_SECRET` | The exact same key as `TGE_EMAIL_SECRET` |

Keep the existing Cloudflare and staff owner secrets. The Gmail settings take precedence over old Resend settings, so an unused Resend API key does not force you to buy a domain. The shared sender key and endpoint are stored as server-only Cloudflare secrets during deployment.

Open **Actions → Deploy Imperial Support to Cloudflare → Run workflow**, select **main**, and keep the existing **tge-support** project name. Existing tickets and staff credentials are preserved.

## 5. Check delivery

Open a test ticket, add an inbox you control, and confirm the link from **TGE Support**. Send a public staff reply and check the member receives the alert. Private notes stay in the portal. Real inbox delivery has not been tested until you complete this walkthrough.

Google currently lists **100 email recipients per day** for consumer Apps Script accounts. Confirmation messages and reply alerts both use this quota, and other scripts using the same account may consume it. Limits can change; the script checks the remaining quota before sending. Exceeding it leaves staff replies saved with a failed alert that can be retried through the support console.

Requests are signed with HMAC-SHA256 and expire after five minutes. Script locks and durable receipts prevent concurrent duplicate sends. If Google's send result is uncertain, the script preserves that receipt and refuses to resend it automatically. Review that case manually instead of repeatedly resetting the key or deleting receipts. Ordinary failed alerts remain retryable for 23 hours in the support console. This small-volume sender is not an unlimited bulk-email service.

If you change the Apps Script code later, use **Deploy → Manage deployments → Edit → New version** to update the existing deployment and retain its `/exec` URL. Editing the project alone does not update a published web app.

## Official references

- [MailApp and its send-only permission](https://developers.google.com/apps-script/reference/mail/mail-app)
- [Google Apps Script web apps](https://developers.google.com/apps-script/guides/web)
- [Daily quotas](https://developers.google.com/apps-script/guides/services/quotas)
- [Content Service redirects](https://developers.google.com/apps-script/guides/content)
