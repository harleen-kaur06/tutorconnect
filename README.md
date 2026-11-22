# Harleen Tutoring Portal

A web portal where a tutor and her students stay in sync: **schedule classes with Google Meet links, assign homework, collect student work in the tutor's Google Drive, and send feedback.**

- **Live site:** https://harleen-kaur06.github.io/tutorconnect/
- **Portal (login):** https://harleen-kaur06.github.io/tutorconnect/#/portal

> The GitHub repository and the build folder are still named `tutorconnect`. Renaming the repo would change the GitHub Pages URL (and everything that depends on it), so only the visible branding was changed.

---

## Table of contents
1. [Features](#features)
2. [How it works (architecture)](#how-it-works-architecture)
3. [Tech stack](#tech-stack)
4. [Project structure](#project-structure)
5. [Data model](#data-model)
6. [Database migrations](#database-migrations)
7. [Edge Functions](#edge-functions)
8. [Configuration reference (all secrets and variables)](#configuration-reference)
9. [Full setup guide](#full-setup-guide)
10. [Deployment (GitHub Actions)](#deployment-github-actions)
11. [Run locally](#run-locally)
12. [Google Drive file storage](#google-drive-file-storage)
13. [Business rules](#business-rules)
14. [Security and privacy notes](#security-and-privacy-notes)
15. [Troubleshooting](#troubleshooting)
16. [Known limitations and before-launch checklist](#known-limitations-and-before-launch-checklist)
17. [GitHub repository About settings](#github-repository-about-settings)

---

## Features

**Public website** (hash routes)
- `#/` home page, `#/privacy` privacy policy (draft), `#/terms` terms of service (draft)
- "Login to Portal" button leads to `#/portal`

**Accounts**
- Email and password sign-up / sign-in through Supabase Auth
- Two roles: **student** (default for every self-registered account) and **tutor** (promoted manually in the database)
- Classes show a **Live now** tag while in session. When a class has ended, the Meet link is removed, the class is marked **Completed** and moves to a *Past classes* list (tutor and student)
- **Forgot password** link on the sign-in card; reset and sign-up confirmation links land back in the portal
- **Tutor approval of new students**: new sign-ups wait on an approval screen until the tutor approves them in the Students tab (existing accounts were approved automatically)
- Visible **Sign out** button in the header (and a sidebar icon)

**Tutor**
- Schedule a class: pick a student from a **dropdown**, date/time and duration. A Google Calendar event with a unique **Google Meet** link is created, and the student receives a calendar invitation by email
- Create homework: student **dropdown**, title, instructions, due date and an optional attachment (PDF, DOC, DOCX, JPG, PNG, max 10 MB)
- Homework table with status filters (All / Pending / Overdue / Submitted / Reviewed), search and pagination (10 per page)
- Submissions table with filters (All / Needs review / Reviewed), search and pagination, view each student's file, write feedback and send it
- **Reschedule or cancel** a class (updates or deletes the Google Calendar event, so the student's invitation follows)
- **Edit or delete** homework until the student has submitted
- Students list with **Approve / Decline** for new sign-ups, overview statistics, Refresh button
- Warning banner when the Google connection has expired or is missing permissions
- **Email notifications** sent from the tutor's Gmail: homework assigned (to student), work submitted (to tutor), feedback sent (to student)
- Connect Google (Calendar and Drive) button

**Student**
- See upcoming classes and join the Meet link
- Homework table: attachment, status, feedback
- Upload completed work (PDF, DOC, DOCX, JPG, PNG, max 10 MB). The due date disappears once the work is submitted. Past-due homework that is still pending is marked **Overdue** in red
- Read the tutor's feedback on the same row

**Review lock**
- After the tutor sends feedback, the submission and the feedback are **locked**: the tutor cannot edit the feedback and the student cannot replace the file. This is enforced in the UI, in the Edge Function and by a database trigger

**Mobile and tablet (app-like)**
- On phones and tablets (up to 900 px wide) the portal switches to an app layout: a top bar with the page title and an account menu, and a **bottom tab bar** with badges (submissions to review, students waiting, homework to do)
- Tables become tappable **cards** on phones; filters scroll sideways; forms and menus open as **bottom sheets**; "New class" / "Create homework" become a floating button
- Touch-friendly sizing, safe-area support for notched phones, 16 px inputs (no iOS zoom)
- **Installable (PWA):** add it to the home screen (iPhone: Share, Add to Home Screen; Android: browser menu, Install app) and it opens full screen like an app

**Other**
- Pages refresh automatically every 30 seconds and when the browser tab regains focus
- Demo mode: without Supabase credentials the app runs with sample data (nothing is shared or saved)

---

## How it works (architecture)

```
Browser (React app on GitHub Pages)
   │  supabase-js
   ├──► Supabase Auth ........ sign-up / sign-in / sessions
   ├──► Supabase Postgres .... profiles, classes, homework, submissions (protected by Row Level Security)
   └──► Supabase Edge Functions (Deno)
            ├── google-auth-start ........ begins the Google consent flow (tutor only)
            ├── google-oauth-callback .... receives Google's redirect, stores the tutor's refresh token
            ├── google-calendar-status ... tells the UI whether Google is connected
            ├── create-class ............. creates the Calendar event + Meet link, saves the class
            ├── upload-file .............. saves homework attachments / submissions to the tutor's Google Drive
            ├── download-file ............ streams a Drive file to an authorized student or tutor
            ├── manage ................... tutor-only actions: cancel/reschedule class, edit/delete homework, approve/decline student
            └── send-notification ........ emails students/tutor through the tutor's Gmail
                         │
                         └──► Google Calendar API, Google Meet, Google Drive API (using the tutor's stored refresh token)
```

Key points:
- **GitHub Pages only serves static files.** All data and logic that must be secure live in Supabase.
- The tutor connects her Google account **once**. Her OAuth *refresh token* is stored in `google_calendar_connections`, a table with **no client policies**, so only Edge Functions (service role) can read it.
- Files are **not public** in Drive. Students and tutors open them through `download-file`, which checks who is allowed to see each file.
- The site uses **hash routing** (`#/portal`). Anything after `#` never reaches a server, which is why GitHub Pages needs no special routing setup.

---

## Tech stack

| Area | Technology |
|---|---|
| Frontend | React 18, Vite 6, lucide-react icons, plain CSS |
| Backend | Supabase: Auth, Postgres, Edge Functions (Deno / TypeScript) |
| Integrations | Google Calendar API, Google Meet (conferenceData), Google Drive API, Google OAuth 2.0 |
| Hosting / CI | GitHub Pages, GitHub Actions |

---

## Project structure

```
.
├── .github/workflows/deploy.yml     # build site, deploy Supabase migrations + functions, publish to Pages
├── index.html                       # page title, mobile / PWA meta tags
├── public/                          # manifest.webmanifest, sw.js (no caching), app icons
├── package.json
├── vite.config.js                   # base: '/tutorconnect/' (must match the repo name)
├── src/
│   ├── main.jsx                     # whole React app (public site, auth, tutor + student portal)
│   └── style.css
└── supabase/
    ├── config.toml                  # verify_jwt = false for google-oauth-callback
    ├── migrations/
    │   ├── 202611200001_google_calendar.sql
    │   ├── 202611200002_drive_storage.sql
    │   ├── 202611200003_lock_reviewed_submissions.sql
    │   ├── 202611200004_class_duration.sql
    │   └── 202611200005_student_approval.sql
    └── functions/
        ├── google-auth-start/index.ts
        ├── google-oauth-callback/index.ts
        ├── google-calendar-status/index.ts
        ├── create-class/index.ts
        ├── upload-file/index.ts
        ├── download-file/index.ts
        ├── manage/index.ts
        └── send-notification/index.ts
```

---

## Data model

> **Important:** the base tables (`profiles`, `classes`, `homework`, `submissions`), their Row Level Security policies and the `homework-files` storage bucket were created **before** the migrations in this repo (from an earlier `schema.sql` that is not committed). The migrations below only *add* to them. Export your current schema and commit it so the repo is reproducible:
> ```bash
> npx supabase db dump --db-url "$SUPABASE_DB_URL" -f supabase/schema.sql
> ```
> The columns below are the ones the application code relies on.

| Table | Purpose | Columns used by the app |
|---|---|---|
| `profiles` | One row per user | `id` (= auth user id), `email`, `full_name`, `role` (`student` or `tutor`), `approved` (boolean; students need tutor approval) |
| `classes` | Scheduled sessions | `id`, `title`, `starts_at`, `meet_url`, `student_id`, `tutor_id`, `google_event_id`, `calendar_event_url`, `meeting_status` (`manual`, `pending`, `ready`, `cancelled`), `duration_minutes` (default 60) |
| `homework` | Assignments | `id`, `title`, `description`, `due_date`, `student_id`, `tutor_id`, `created_at`, `status`, `file_url` (legacy Supabase Storage path), `drive_file_id`, `file_name`, `file_mime` |
| `submissions` | Student uploads and feedback | `id`, `homework_id`, `student_id`, `submitted_at`, `file_url` (legacy), `drive_file_id`, `file_name`, `file_mime`, `feedback`, `reviewed_at` |
| `google_calendar_connections` | Tutor's Google link (server-only) | `user_id`, `google_email`, `refresh_token`, `connected_at`, `updated_at` |
| `google_oauth_states` | One-time OAuth `state` values (server-only) | `state`, `user_id`, `expires_at`, `created_at` |

Storage: the private bucket `homework-files` holds **legacy** files uploaded before the Drive change. They still open through signed URLs. New files go to Google Drive.

---

## Database migrations

Migrations live in `supabase/migrations/` and are applied automatically by the GitHub workflow (`supabase db push`) when you push to `main`. Supabase records which ones ran, so each runs once, in filename order.

| File | What it does |
|---|---|
| `202611200001_google_calendar.sql` | Adds `google_event_id`, `calendar_event_url`, `meeting_status` to `classes`. Creates `google_calendar_connections` and `google_oauth_states` with Row Level Security **enabled and no policies**, so only the service role (Edge Functions) can access them |
| `202611200002_drive_storage.sql` | Adds `drive_file_id`, `file_name`, `file_mime` to `homework` and `submissions` |
| `202611200005_student_approval.sql` | Adds `profiles.approved` (default false), marks all existing accounts approved, and adds a trigger so browser users can never approve themselves (only the service role / SQL editor can) |
| `202611200003_lock_reviewed_submissions.sql` | Creates a `BEFORE UPDATE` trigger on `submissions` that raises an error if the row already has `reviewed_at`, locking reviewed submissions and their feedback |
| `202611200004_class_duration.sql` | Adds `duration_minutes` (default 60) to `classes`. Used to mark a class **Completed** and hide its Meet link once it has ended |

To run one by hand instead: Supabase Dashboard, SQL Editor, paste the file, Run. To add a new migration, create `supabase/migrations/<timestamp>_<name>.sql` with a timestamp later than the existing ones.

---

## Edge Functions

| Function | Called by | Who may call it | What it does |
|---|---|---|---|
| `google-auth-start` | "Connect Google Calendar" button | Tutor | Stores a one-time `state`, returns the Google consent URL (scopes: `openid email calendar.events drive gmail.send`) |
| `google-oauth-callback` | Google (redirect) | Anyone with a valid `state` (`verify_jwt = false`) | Exchanges the code for tokens, stores the refresh token, redirects to `APP_URL` with `?google_calendar=connected` (or `error`) |
| `google-calendar-status` | Portal on load and every 5 minutes | Signed-in user | For the tutor, tests the stored refresh token and returns `{ connected, healthy, drive, gmail, google_email }` so the UI can show a reconnect banner |
| `create-class` | "Schedule class" form | Tutor | Validates input, creates the Calendar event with a Meet link and email invite, retries briefly for the Meet URL, saves the class with its duration (deletes the event if saving fails) |
| `upload-file` | Homework form (tutor) and upload button (student) | Tutor (kind `homework`) or the assigned student (kind `submission`) | Validates type (pdf, doc, docx, jpg, jpeg, png) and size (10 MB), creates folders in Drive, uploads the file, inserts the database row (removes the Drive file if the insert fails). Rejects uploads for already-reviewed work |
| `manage` | Tutor actions in the portal | Tutor only | `class.cancel`, `class.reschedule` (also update/delete the Google Calendar event), `homework.update`, `homework.delete` (only before any submission; also removes the Drive attachment), `student.approve`, `student.decline` (deletes an unapproved account) |
| `send-notification` | Portal after assigning homework, submitting work, sending feedback | The tutor or the student involved | Sends a plain-text email via the Gmail API from the tutor's connected account. Best effort: failures never block the action |
| `download-file` | "Open" / "View file" buttons | Tutor or the student the item belongs to | Checks access, fetches the file from Drive with the tutor's token and streams it back |

Functions use the Supabase-provided `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, which need no setup.

---

## Configuration reference

### 1. GitHub repository secrets
*Settings, Secrets and variables, Actions, New repository secret*

| Secret | Value |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL, e.g. `https://xxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon (public) key |
| `SUPABASE_ACCESS_TOKEN` | Personal access token from supabase.com/dashboard/account/tokens |
| `SUPABASE_PROJECT_REF` | The project reference (the `xxxx` in the project URL) |
| `SUPABASE_DB_URL` | Postgres connection string using the **session pooler** (IPv4 compatible), with your database password |

### 2. Supabase Edge Function secrets
*Dashboard, Edge Functions, Secrets (or `npx supabase secrets set NAME=value`)*

| Secret | Value |
|---|---|
| `APP_URL` | `https://harleen-kaur06.github.io/tutorconnect/#/portal` (where Google sends the tutor back; the `#/portal` makes her land in the portal) |
| `GOOGLE_CLIENT_ID` | From the Google Cloud OAuth client |
| `GOOGLE_CLIENT_SECRET` | From the Google Cloud OAuth client |
| `GOOGLE_REDIRECT_URI` | `https://<project-ref>.supabase.co/functions/v1/google-oauth-callback` (must match Google exactly) |
| `DRIVE_ROOT_FOLDER_ID` | The ID at the end of the Drive folder URL (`.../folders/<ID>`) |

### 3. Local `.env` (only for `npm run dev`)
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```
Never commit `.env` (add it to `.gitignore`). Without these values the app starts in demo mode.

---

## Full setup guide

### Step 1: Supabase project
1. Create a project at supabase.com.
2. Create the base tables, policies and the private `homework-files` bucket (your original `schema.sql`). Then the migrations in this repo add the rest.
3. **Authentication, Providers:** enable Email.
4. **Authentication, URL Configuration:** set **Site URL** to `https://harleen-kaur06.github.io/tutorconnect/` and add the same URL to **Redirect URLs**. Password-reset and sign-up confirmation links return to this URL; the app detects them and opens the portal (or the "Set a new password" screen).

### Step 2: Create the tutor account
Every new sign-up is a **student**. Register the tutor in the app, then in the Supabase SQL Editor run:
```sql
update public.profiles set role = 'tutor' where email = 'tutor@example.com';
```

### Step 3: Google Cloud
1. Create (or pick) a project at console.cloud.google.com.
2. **APIs and Services, Library:** enable **Google Calendar API**, **Google Drive API** and **Gmail API**.
3. **OAuth consent screen:** add the scopes `openid`, `email`, `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/drive` and `https://www.googleapis.com/auth/gmail.send` (send-only; the app cannot read any email).
   - While the app is in **Testing**, add the tutor's Google account under **Test users**, and note that Google expires refresh tokens after **7 days** (the tutor then has to click Connect again). Publishing the app removes that limit; the Drive scope is a restricted scope, so check Google's verification requirements before going public.
4. **Credentials, Create credentials, OAuth client ID, Web application.** Under **Authorized redirect URIs** add exactly the value of `GOOGLE_REDIRECT_URI`.
5. Copy the client ID and secret into the Supabase secrets.

### Step 4: Google Drive folder
1. In the tutor's Drive, create a folder (e.g. `Harleen Tutoring`).
2. Copy the ID from its URL: `https://drive.google.com/drive/.../folders/<THIS_PART>`.
3. Save it as `DRIVE_ROOT_FOLDER_ID`.
4. Connect Google with the **same Google account** that owns or can edit this folder.

### Step 5: GitHub
1. Add the repository secrets above.
2. **Settings, Pages:** set the source to **GitHub Actions**.
3. Push to `main` (or run the workflow manually). It builds the site, applies migrations, deploys the functions and publishes Pages.

### Step 6: First login
1. Open `.../#/portal`, sign in as the tutor.
2. Click **Connect Google Calendar** (top right) and tick **all** requested permissions, including Drive.
3. Register a student account (or ask the student to), then schedule a class or create homework.

---

## Deployment (GitHub Actions)

`.github/workflows/deploy.yml` runs on every push to `main` (and manually) with three jobs:

1. **build** installs dependencies and builds the Vite app with the `VITE_*` secrets.
2. **deploy-supabase** runs `supabase db push` (migrations) and deploys all six Edge Functions. It uses `npx supabase@latest` instead of `supabase/setup-cli` to avoid the GitHub API "rate limit exceeded" error.
3. **deploy** publishes the built site to GitHub Pages (after `build`).

`vite.config.js` sets `base: '/tutorconnect/'`. If you rename the repository, change this to `/<new-name>/` and update `APP_URL`, the Supabase Auth URLs and the Google settings.

GitHub Pages on a free account requires a **public** repository. The repository contains no secrets (they live in GitHub and Supabase secrets).

---

## Run locally

Requires Node.js 20 or newer.
```bash
npm install
# create .env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (optional; demo mode without them)
npm run dev        # http://localhost:5173/tutorconnect/
npm run build      # production build into dist/
npm run preview
```
Google Calendar and Drive features need the deployed Edge Functions and secrets, so they work against your Supabase project, not in demo mode. For the Google redirect to return to localhost during development, set `APP_URL` accordingly.

---

## Google Drive file storage

Files are saved under the root folder, one folder per student:

```
Harleen Tutoring/                 <- DRIVE_ROOT_FOLDER_ID
  Student Name/
    Homework assigned/            2026-11-20 - worksheet.pdf
    Homework submitted/           2026-11-21 - answers.png
```

- Folders are created automatically on first use (student folder name = full name, or email if no name).
- File names get the upload date as a prefix.
- Allowed types: **PDF, DOC, DOCX, JPG, JPEG, PNG**. Maximum **10 MB**. The browser checks first, and `upload-file` enforces it again (the type is decided from the extension, not from what the browser claims).
- Nothing is shared publicly in Drive. All access goes through `download-file`.
- If the tutor's Google connection expires or is revoked, uploads and downloads fail with a message telling the tutor to reconnect.

---

## Business rules

- New accounts are always students; only a database update makes someone a tutor.
- Only a tutor can create classes and homework, and only for **approved** students.
- New students are unapproved until the tutor approves them; unapproved students see a waiting screen and cannot see any data.
- Homework can be edited or deleted only while it has no submission.
- A cancelled class is kept in the Past classes list with a Cancelled tag.
- A student can submit only to homework assigned to them. Before review, they may **replace** the file (the tutor sees the latest upload).
- Once the tutor sends feedback: feedback is final, the student can no longer replace the file, and the database rejects further changes to that submission.
- Feedback cannot be empty, and sending asks for confirmation.
- Classes must be in the future; duration is limited to 15 to 180 minutes.

---

## Security and privacy notes

- Database access is controlled by **Row Level Security**. The anon key is public by design, so RLS policies are your real protection. Review them before launch.
- The Google refresh token is readable only with the service role. The Drive scope gives the app access to the connected account's Drive; use a Google account you are comfortable with, and revoke access any time at myaccount.google.com/permissions.
- Students may be minors: obtain appropriate parent or guardian consent and keep stored personal information to a minimum.
- The privacy policy and terms pages are **starter drafts**. Add a real operator name and a monitored support email, and get them reviewed before public use.

---

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| "Google Drive permission is missing or expired" | The tutor must click **Connect Google Calendar** again and tick the Drive permission. Make sure Drive API is enabled and the `drive` scope is on the consent screen |
| "Google authorization expired or was revoked" | Refresh token expired (7 days in Testing mode) or access was revoked. Reconnect |
| "Drive folder not found" | Wrong `DRIVE_ROOT_FOLDER_ID`, or Google was connected with an account that cannot edit that folder |
| Class creation fails | Read the red/blue notice: it now shows the real error. Check the Edge Function logs. Common causes: Google not connected, student not registered, Calendar API disabled |
| Notification emails are not sent | The tutor must reconnect Google once and tick the Gmail send permission; the Gmail API must be enabled in Google Cloud. Emails come from the tutor's own Gmail address and may land in spam the first time |
| New student cannot get in | They are waiting for approval: open the Students tab and click Approve |
| Landing on the public home page after Google connect | `APP_URL` is missing the `#/portal` suffix |
| Workflow: "Failed to resolve latest Supabase CLI release: rate limit exceeded" | Fixed by using `npx supabase@latest` in the workflow. Re-run failed jobs if it ever recurs |
| Student sees no attachment on old homework | Legacy files in the Supabase bucket need a storage read policy that allows the assigned student |
| Site returns 404 | Pages source must be GitHub Actions, and `base` in `vite.config.js` must match the repo name |

Edge Function logs: Supabase Dashboard, Edge Functions, choose the function, Logs.

---

## Known limitations and before-launch checklist

- [ ] Commit the base `supabase/schema.sql` (tables, RLS policies, bucket) so the repo can rebuild the database
- [ ] Review all RLS policies and storage policies
- [ ] Publish the Google OAuth app (or accept the 7-day reconnect) and complete Google verification if required
- [ ] Finish the privacy policy and terms (operator name, contact email, retention, guardian consent)
- [ ] One tutor per deployment: the design assumes a single tutor account
- [ ] Multiple files per submission, recurring classes and group classes are not implemented yet
- [ ] Add automated tests and rate limiting if opening to the public

---

## GitHub repository About settings

**Description**
> Harleen Tutoring Portal: a React + Supabase web app where a tutor schedules Google Meet classes, assigns homework, collects student work in Google Drive and sends feedback.

**Website:** `https://harleen-kaur06.github.io/tutorconnect/`

**Topics**
`tutoring` `education` `student-portal` `homework-management` `react` `vite` `supabase` `edge-functions` `google-calendar` `google-meet` `google-drive` `github-pages` `github-actions`

Set these on the repository page via the gear icon next to **About**.
