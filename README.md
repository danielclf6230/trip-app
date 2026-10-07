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

Database separation and shopping photos:

- Run `npm run migrate:tooldb` from `backend` to move existing `trip_users` and `trip_tools_*` tables together into `tooldb`, create `trip_tools_photos`, and update the local `.env`. The migration refuses to overwrite an occupied target schema. MySQL DDL is not transactional; the table move uses one atomic `RENAME TABLE` statement.
- Restart the backend after migration. Set `DB_NAME=tooldb` in the deployed backend environment as well.
- Set `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `S3_BUCKET` on the backend (the same configuration names as coupleapp). Use `AWS_REGION=us-east-2` and `S3_BUCKET=trip-tools-daniel-2026`. Keep Block all public access enabled and ACLs disabled. Photos use `trip-tools/<trip-id>/` object keys; the authenticated backend returns signed read URLs valid for one hour, refreshed by the frontend. Credentials need `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` on `arn:aws:s3:::trip-tools-daniel-2026/trip-tools/*`. Signed URLs are temporary and are never stored in trip data or the database.
- Upload JPEG, PNG, WebP, or GIF images up to 10 MB from the shopping composer or beside an existing item. Click a thumbnail to enlarge it; close with the Close button, Escape, or the backdrop.
- Photo records are scoped to a trip and accessible through authenticated membership checks. Replacing or removing a list item does not delete its S3 object; unused objects can be cleaned up separately.
