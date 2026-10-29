# AICTE Approval Workflow Automation, Compliance Monitoring & Alert Management System

SIH prototype. A web app where institutions submit AICTE approval applications, the system routes them to the right officer, checks them against norms, tracks deadlines, raises alerts and keeps a full audit trail.

## Tech stack (all free, no accounts needed)

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite, React Router, plain CSS (Bricolage Grotesque + Manrope, same design language as Clausewise and Kilometre) |
| Backend | Node.js + Express |
| Auth | Supabase Auth: email + password, institution self-registration, password reset by email |
| Database | Supabase Postgres (tables are created automatically, with Row Level Security on) |
| File uploads | Supabase Storage, private `documents` bucket, served through short-lived signed links |
| Live updates | Supabase Realtime pushes new notifications to the bell instantly |
| Alerts | In-process scheduler, runs every 5 minutes and after every action |

Requires **Node.js 22.13 or newer** (tested on Node 24) and a free Supabase project.

## Set up Supabase (one time)

1. Create a free project at supabase.com.
2. Copy `.env.example` to `.env` and fill in the values from the project: URL, service role (secret) key, anon (publishable) key and the **Session pooler** connection string.
3. Authentication → URL Configuration: set Site URL to `http://localhost:4000` and add `http://localhost:4000/reset-password` to Redirect URLs.
4. Optional, for the demo: Authentication → Providers → Email → turn off "Confirm email" so new institutions can sign in straight away.

### Verification codes instead of links

Sign-up and password reset use a code typed into the site, so nobody has to click a link. In Supabase → Authentication → Email Templates, edit **Confirm signup** and **Reset Password** so the body shows the code:

```html
<h2>Your AICTE Approvals code</h2>
<p>Enter this code on the website: <strong style="font-size:24px">{{ .Token }}</strong></p>
<p>It expires in 1 hour. If you didn't ask for it, ignore this email.</p>
```

### Email notifications (optional)

Add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `EMAIL_FROM` (see `.env.example`). A Gmail App Password is the quickest free option. With them set, alerts are emailed as well as shown in the bell. Each person gets one email per batch, and sample accounts (`.demo` addresses) are never emailed. Putting the same SMTP details into Supabase → Authentication → SMTP Settings also removes Supabase's low hourly limit on code emails.

## Run it

```bash
npm install
npm run build      # build the frontend (re-run after changing .env)
npm start          # http://localhost:4000. The first start creates tables and loads sample data.
```

For development with hot reload: `npm run dev`, then open http://localhost:5173.

To reset to fresh sample data: `npm run seed` (stop the server first). Demo logins are kept.

### Demo accounts (password `demo123`)

| Role | Email |
|---|---|
| Institution (Shri Venkatesh Institute of Technology, Pune) | `college@aicte.demo` |
| Scrutiny Officer (Rajiv Menon, West) | `officer@aicte.demo` |
| Administrator (Approval Bureau) | `admin@aicte.demo` |

Only these three can sign in. The other sample officers and principals exist as records so assignment and workload look realistic. New institutions can register from the sign-in page.

## Features mapped to the problem statement

1. **Application management**: institution details, application records, submission dates, required documents and status, all in one database.
2. **Automated officer assignment**: the rule is category → eligible designation → officer handles that category → has free capacity → same region preferred → lowest workload. The reason is stored in the audit trail. Admins can reassign manually or automatically, and can pause an officer.
3. **Document verification**: required documents for each category, missing-document detection, officer verify/reject with a remark, and the institution is notified so it can re-upload.
4. **Compliance monitoring**: a live compliance score from 7 checks (documents uploaded, documents verified, faculty-student ratio, land area, built-up area, certificate validity, processing deadline). Approval is blocked until every check passes. Institutions see a readiness check before they submit.
5. **Automated alerts**: deadline approaching, overdue (escalated to admin), missing documents, review not started, rejected documents, certificates expiring or expired (also after approval), and status changes.
6. **Centralized dashboard**: total, pending, action required, approved, overdue and compliance-alert counts, status and category breakdowns, items needing attention, officer workload and recent activity. Each role sees only its own data.
7. **Status tracking**: Submitted → Under Review → Action Required → Approved / Rejected, with a progress stepper, enforced transitions per role, and a timeline with remarks.
8. **Audit trail & reports**: every sign-in, submission, assignment, upload, review and status change is logged with user and time. CSV export of applications and of the audit log.

### Added since

- **Codes instead of links** for sign-up and password reset.
- **Email notifications** for important alerts, sent as one email per person per batch.
- **Deficiency letter (PDF)**, generated from the failed checks, rejected or missing documents and the officer's remarks.
- **Rules & norms screen**: admins edit deadlines, faculty, land and built-up norms, required documents and assignment roles. Every change is audited.
- **User management**: add officers and admins (they receive a code to set their password), edit who handles what, give a sample officer a real login, and suspend or restore any account.
- **Drafts and corrections**: colleges save a draft and finish it later, and can correct their details until the review starts, and again when action is requested. The officer is notified and every change is audited.
- **Approve with an exception**: an officer can approve despite unmet checks only by writing a reason (at least 20 characters). The reason and the waived checks are stored and shown on the application, and the admin is alerted. Missing documents can never be waived.
- **Messages**: a thread on each application between the college and AICTE staff, with live alerts to the other side.
- **Deadlines kept out of the compliance score**: an overdue review no longer lowers the college's score. The deadline is shown as its own flag, with who the delay is on.
- **Phone layout**: a bottom tab bar, tables shown as cards, and full-width dialogs.

## 3-minute demo script

1. **Admin** → Dashboard: 3 overdue, compliance alerts, officer workload. Open the bell to show the escalations.
2. Open *Deccan Plateau Engineering College*: Action Required, overdue on the institution side, a rejected document, and the assignment reason.
3. **Rules & norms**: change the faculty ratio for Engineering and save. Open applications are re-scored immediately. Then **Users & officers**: pause an officer, or add a new one.
4. **Sign out → Institution** → New Application: enter a program and set faculty to 10 to show the readiness check failing, fix it to 13, attach 2 documents, and submit. The app is auto-assigned to Dr. Sameer Kulkarni (West, lowest workload) rather than Rajiv Menon (West, busier).
5. **Sign out → Officer** (`sameer.kulkarni@aicte.demo`): open it, Start review, try Approve (blocked because documents are missing), then Request action with a remark.
6. **Institution**: see the alert, upload the missing documents, Resubmit.
7. **Admin** → Audit Trail: show the full history and download the CSV.

## Deploying to Vercel (free)

The frontend is served from Vercel's CDN, and `api/index.js` runs the same Express app as a serverless function. `vercel.json` already sets the build, routing and a daily alert cron.

1. On vercel.com, choose **Add New → Project**, import `dakshW1/approvals`, and leave the framework preset as **Other**.
2. Under **Environment Variables**, add the same keys as your `.env`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. For `DATABASE_URL`, use Supabase's **Transaction pooler** string (port `6543`). Optionally add a random `CRON_SECRET`.
3. Click **Deploy**.
4. In Supabase → Authentication → URL Configuration, set Site URL to your Vercel URL and add `https://<your-app>.vercel.app/reset-password` to Redirect URLs.

On Vercel each uploaded file is limited to 4 MB, because of Vercel's request size limit. Time-based alerts are rescanned during normal use, at most every 5 minutes, and by the daily cron.

## Future scope

OCR/AI document verification, integration with official AICTE data and officer directories, DigiLocker and Aadhaar eSign, SMS, WhatsApp and email alerts, duplicate faculty detection across institutions, risk scoring for inspections, and a mobile app for geo-tagged inspections.
