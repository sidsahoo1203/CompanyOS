# Deploying CompanyOS on Render

CompanyOS deploys as **one Render web service** (the whole Next.js app: pages
and API together) plus **one Render PostgreSQL database**. Do not split it into
a separate frontend and backend: sign-in cookies and the same-origin checks
require the pages and the API to share one address.

`render.yaml` in the repository describes both. Emails (sign-up verification
and password reset) are sent through [Resend](https://resend.com).

## What production mode changes

Setting `APP_MODE=production` turns on:

- **Verified sign-up.** New accounts must open the emailed link before they can
  sign in. Sign-up gives the same answer for new and existing addresses; the
  owner of an existing address is emailed instead (no account enumeration).
- **Password reset by email.** One-time links valid for 1 hour; a reset signs
  out every session.
- **Secure cookies and HSTS.** The site must be served over HTTPS.
- **Real client addresses for sign-in rate limits.** The first
  `X-Forwarded-For` entry set by Render's proxy is used.
- **Hosted database.** Any PostgreSQL host is allowed, but the app still
  connects only as the two restricted roles `companyos_app` and
  `companyos_auth`. The start script creates them and applies migrations using
  the database owner account, then starts the app **without** the owner
  credentials in its environment.

Local development (`APP_MODE=local`) is unchanged.

## 1. Prepare email (Resend)

1. Create a Resend account.
2. Add your sending domain (for example `yourcompany.com`) under **Domains** and
   add the DNS records Resend shows at your domain registrar. Wait until it
   shows **Verified**. Without a verified domain Resend only delivers to your
   own address, so real customers would never receive their links.
3. Create an API key with **Sending access**. It starts with `re_`. Keep it
   private.
4. Choose the sender, for example `CompanyOS <no-reply@yourcompany.com>`.

## 2. Push the code

Commit and push the latest code to your GitHub repository. `.env.local` and
`work/` are git-ignored and must never be committed.

## 3. Create the Render services

1. In Render, choose **New → Blueprint** and connect the GitHub repository.
   Render reads `render.yaml` and proposes a web service `companyos` and a
   database `companyos-db` in the Singapore region.
2. Render asks for the values marked `sync: false`:
   - `BETTER_AUTH_URL`: the public address, `https://` with no trailing slash.
     Use the service's Render address (for example
     `https://companyos.onrender.com`; Render shows the exact one) or your own
     domain.
   - `RESEND_API_KEY`: the key from step 1.
   - `EMAIL_FROM`: the sender from step 1.
3. `BETTER_AUTH_SECRET`, `APP_DB_PASSWORD` and `AUTH_DB_PASSWORD` are generated
   by Render. `MIGRATION_DATABASE_URL` is linked to the database automatically.
   Do not change the role passwords after launch unless you redeploy straight
   away; every start re-applies them.
4. Choose plans. The web service is set to `starter` (always on). Pick a
   **paid** database plan for real customers: free Render databases expire and
   have no backups.
5. Apply the Blueprint. The first deploy runs `npm ci && npm run build`, then
   `npm run start:render`, which creates the roles, applies all migrations and
   starts the app.

If `BETTER_AUTH_URL` is not known until the service exists, deploy once,
copy the service address, set `BETTER_AUTH_URL` to it under **Environment**,
and deploy again.

## 4. Check the deployment

1. Open `https://<your address>/api/health`. It should show
   `{"status":"ok"}`.
2. Open the site, choose **Create your workspace**, sign up with your own
   email, and open the verification link. You should land on onboarding.
3. Sign out, then use **Forgot password?** to confirm reset emails arrive.
4. In Render **Logs**, look for `email.send_failed` or `auth.unexpected_error`
   lines if anything fails. Each error shown in the app carries a reference
   that matches one log line.

## 5. Your own domain (optional)

Add the domain under the service's **Settings → Custom Domains**, add the DNS
record Render shows, wait for the certificate, then change `BETTER_AUTH_URL`
to `https://yourdomain` and redeploy. Sessions created under the old address
end; users sign in again.

## Troubleshooting

| Symptom in Render logs                                                 | Cause and fix                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompanyOS configuration is missing`                                   | A required variable is empty or malformed: check `RESEND_API_KEY` (starts with `re_`), `EMAIL_FROM` and a 32+ character `BETTER_AUTH_SECRET`.                                                                    |
| `Production requires BETTER_AUTH_URL to be the public https:// origin` | Use `https://`, no path, no trailing slash.                                                                                                                                                                      |
| `The database owner may not create roles`                              | Your database plan's owner account lacks `CREATEROLE`. Create `companyos_app` and `companyos_auth` (LOGIN, passwords equal to `APP_DB_PASSWORD` / `AUTH_DB_PASSWORD`) with your provider's tools, then redeploy. |
| `Applied migration changed`                                            | A migration file that already ran was edited. Restore it and add a new migration instead.                                                                                                                        |
| Sign-up works but no email arrives                                     | The Resend domain is not verified, or the sender address does not use that domain.                                                                                                                               |
| Every sign-in from all users is rate limited together                  | The platform's forwarding header changed; requests without a valid `X-Forwarded-For` share one bucket. Check `src/lib/client-ip.ts`.                                                                             |

## Before inviting paying customers

These are not blockers for a pilot, but plan for them:

- **Backups.** Use a paid database plan with point-in-time recovery and test a
  restore.
- **Legal.** Publish terms of service and a privacy policy; customers will
  upload business documents.
- **Run and approval quotas.** Each workspace may create 1,000 runs and 2,000
  approval requests in its lifetime, and nothing resets them. Decide on monthly
  quotas or plan-based limits before customers reach them.
- **Antivirus.** Uploads pass basic checks only. Connect a real scanner and set
  `UPLOAD_REQUIRE_ANTIVIRUS=true` when you do.
- **Monitoring.** Render keeps logs for a limited time; forward them to a log
  service and add uptime alerts.
- **Billing, account deletion and data export** are not built yet.
