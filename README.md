# Trip Tools

This repo contains:

- `frontend`: Trip Tools Vite + React client
- `backend`: Trip Tools Express + MySQL API

Local setup after cloning:

1. Copy `frontend/.env.example` to `frontend/.env`.
2. Copy `backend/.env.example` to `backend/.env`.
3. Update the backend `.env` with your MySQL credentials and a real `JWT_SECRET`.
4. Install dependencies in both packages if needed.
5. Run `npm run migrate` in `backend` once, then start it with `npm start`.
6. Start the frontend from the repo root with `npm start`, or from `frontend` with `npm start`.

Notes:

- The frontend now defaults to `http://localhost:3000` if `VITE_API_BASE_URL` is not set.
- Authentication is isolated in `trip_users`; the original shared `users` table is not used for login.
- Trip access is controlled by `trip_tools_members`. Invitation codes are single-use and expire after seven days.
- New standalone trip owners are created by an administrator. Invited companions register from the login page.

Render availability and login:

- `Keep Render Alive` checks both apps every five minutes, at minutes 3, 8, 13, and so on (UTC): Trip Tools at `https://tools-backend-v3um.onrender.com/health` and Coupleapp at `https://couplebackend.onrender.com/`. Each runs as an independent matrix job, so a failure in one does not cancel the other. Both retry network/HTTP failures. Trip Tools must report application and database readiness; Coupleapp must return its existing `✅ API is running` health response (which does not verify its database). The obsolete `daily-costs-app` service is no longer used.
- Run this repository's workflow manually from GitHub Actions to check both apps together. Coupleapp's separate keep-alive workflow is also enabled; this combined workflow covers both apps independently of that separate schedule.
- The login screen starts waking the backend as soon as it opens. Submission shares that readiness check, waits up to two minutes for a cold start, then sends the login or registration request once. Invalid credentials and rate limits are shown without automatically retrying credentials. A connection failure lets the user try again.
- GitHub schedules run from the default branch and [can be delayed or dropped](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). In public repositories, schedules are disabled after 60 days without activity; re-enable the workflow in Actions if needed. Keep-alive reduces cold starts but cannot guarantee immediate login.
- [Render Free services](https://render.com/docs/free) sleep after 15 idle minutes and share 750 free instance hours per workspace each month. Keeping several services awake can exhaust that allowance. A suspended service cannot be restored by pinging it.
- Commit and push these changes to `main`, let the web frontend deploy, and run **Keep Render Alive** manually to check the new workflow. Installed mobile/desktop apps need a new build/update to receive the login changes; see the platform guides. The Windows release workflow now runs all frontend regression tests before building its signed installer.

Database separation and shopping photos:

- Run `npm run migrate:tooldb` from `backend` to move existing `trip_users` and `trip_tools_*` tables together into `tooldb`, create `trip_tools_photos`, and update the local `.env`. The migration refuses to overwrite an occupied target schema. MySQL DDL is not transactional; the table move uses one atomic `RENAME TABLE` statement.
- Restart the backend after migration. Set `DB_NAME=tooldb` in the deployed backend environment as well.
- Set `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `S3_BUCKET` on the backend (the same configuration names as coupleapp). Use `AWS_REGION=us-east-2` and `S3_BUCKET=trip-tools-daniel-2026`. Keep Block all public access enabled and ACLs disabled. Photos use `trip-tools/<trip-id>/` object keys; the authenticated backend returns signed read URLs valid for one hour, refreshed by the frontend. Credentials need `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` on `arn:aws:s3:::trip-tools-daniel-2026/trip-tools/*`. Signed URLs are temporary and are never stored in trip data or the database.
- Upload JPEG, PNG, WebP, or GIF images up to 10 MB from the shopping composer or beside an existing item. Click a thumbnail to enlarge it; close with the Close button, Escape, or the backdrop.
- Photo records are scoped to a trip and accessible through authenticated membership checks. Replacing or removing a list item does not delete its S3 object; unused objects can be cleaned up separately.
