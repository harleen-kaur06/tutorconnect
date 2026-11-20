# Harleen Tutoring Portal

A lightweight tutoring portal prototype designed for GitHub Pages + Supabase.

## Features
- Tutor and student dashboards
- Class schedule with Google Meet join links
- Homework publishing and student file submissions
- Tutor feedback on submissions
- Supabase authentication, database and file storage
- Demo preview without Supabase (data is local to the current browser session)

## Important architecture notes
GitHub Pages hosts static files only. It cannot securely store student accounts, homework files or shared data by itself. This project uses Supabase for authentication, database and storage. Google Meet links are pasted in by the tutor after creating a Google Calendar event; fully automatic event creation requires Google OAuth and additional API setup.

## Run locally
1. Install Node.js 20+.
2. `npm install`
3. Copy `.env.example` to `.env` and add your Supabase project URL and anon key.
4. `npm run dev`

Without Supabase credentials, the app opens in demo mode. Demo entries are not shared across devices.

## Supabase setup
1. Create a Supabase project.
2. Open SQL Editor and run `supabase/schema.sql`.
3. In Authentication settings, enable email/password sign-in. For a real launch, configure email confirmation and your site URL.
4. Add `.env` values locally. In GitHub, add repository secrets/variables for the Pages workflow.
5. Sign up the tutor account, then run `update public.profiles set role='tutor' where email='you@example.com';` in Supabase SQL Editor. All self-registered accounts default to `student`; users cannot promote themselves to tutor through the app.
6. Keep the homework storage bucket private. The app stores private storage paths and generates short-lived signed URLs for submitted files. Before production, tighten storage read policies so only the relevant tutor/student can access each file.

## Publish with GitHub Pages
1. Create a GitHub repository named `tutorconnect`.
2. Upload this project to the repository root.
3. In **Settings → Secrets and variables → Actions**, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. In **Settings → Pages**, set source to **GitHub Actions**.
5. Push to the `main` branch. The workflow builds and deploys the app.
6. Your site will be at `https://YOUR-USERNAME.github.io/tutorconnect/`.

If you use a different repository name, update `base` in `vite.config.js` to `/<repo-name>/`.

## Google Meet scheduling
Create a Calendar event in Google Calendar, add the student as a guest, enable Google Meet, save, and paste the generated Meet URL into the class form. The student can then join from their dashboard.

## Before using with real students
This is an MVP starter, not a production-ready student information system. Add tutor invitation/approval, stronger file access controls, rate limiting, backups, privacy policy, terms, data deletion workflow, and testing. Avoid collecting unnecessary student personal information. If students are minors, obtain appropriate parent/guardian consent and use age-appropriate account and data practices.


## Public website pages added
- `#/` public homepage
- `#/privacy` privacy policy draft
- `#/terms` terms of service draft
- `#/portal` existing tutor/student portal

Before public launch, review and complete the legal policy placeholders, confirm Google OAuth scopes and actual data handling, add a monitored support contact, and obtain appropriate legal review.
