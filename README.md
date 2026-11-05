# Vale API

Back end for Vale, the association's app that helps people with intellectual
disabilities meet up, do sport and go to events together. It serves the
[vale-frontend](https://github.com/Rubengon84/vale-frontend) app.

Node.js 22, Express 5, PostgreSQL and Auth0.

## Getting started

Requires Node.js 22.12+ (see `.nvmrc`) and PostgreSQL 14+.

```bash
cp .env.example .env      # then fill in the values
npm install
npm run db:migrate        # create or update the tables
npm run db:seed           # optional: sample data (not in production)
npm run dev               # http://localhost:4000
```

| Script               | What it does                                         |
| -------------------- | ---------------------------------------------------- |
| `npm run dev`        | Start with auto-reload                               |
| `npm start`          | Start for production                                 |
| `npm run db:migrate` | Apply pending files in `src/db/migrations/`          |
| `npm run db:seed`    | Replace all data with sample data (dev only)         |
| `npm run db:reset`   | Drop everything and re-run migrations (dev only)     |
| `npm run make-admin -- <email>` | Make an existing account an approved admin |
| `npm test`           | Run the tests (needs a test database, see below)     |
| `npm run lint`       | Lint                                                 |

### Tests

Tests run against a real PostgreSQL database, which they wipe. Point
`TEST_DATABASE_URL` at an empty database (default
`postgres://vale:vale@localhost:5432/vale_test`).

## Authentication

Every endpoint except `GET /health` needs an Auth0 access token:
`Authorization: Bearer <token>`. The API checks the signature, issuer, audience
and expiry, and takes the user id from the token's `sub` claim. It never trusts
a user id sent in the request.

Set-up in Auth0:

1. Applications → APIs → Create API, e.g. identifier `https://api.vale.example`.
2. Put that identifier in `AUTH0_AUDIENCE` here and in `VITE_AUTH0_AUDIENCE`
   in the front end.

After logging in, the front end calls `PUT /users/me` to create the profile.
Until then other endpoints answer `403` with code `registration_required`.

## Roles and account approval

| Role          | Can do |
| ------------- | ------ |
| `participant` | See the programme, sign up in the participant quota, "Mis planes" |
| `volunteer`   | See the programme, sign up in the volunteer quota, "Mis planes" |
| `admin`       | Everything above except signing up, plus manage the programme, photos, sign-ups and accounts |

New accounts start as `participant` with status `pending`. While pending they
can only read, edit or delete their own profile; everything else answers
`403` with code `account_pending`. An admin approves them and sets the role
(`PATCH /admin/users/:userId`). Blocked accounts get `account_blocked`.

**The first admin:** log in to the app once (so the account exists), then:

```bash
npm run make-admin -- someone@example.org
```

On Render, run it from the service's **Shell** tab, or from your computer with
`DATABASE_URL` pointing at the production database.

## API

Responses are JSON. Errors look like
`{ "error": "Human readable message", "code": "machine_code" }`; validation
errors add `details`.

### Users

| Method | Path                    | Who | Description |
| ------ | ----------------------- | --- | ----------- |
| PUT    | `/users/me`             | anyone logged in | Register on first login (`201`, pending), or refresh the email (`200`). Body: `name`, `email?`, `photo_url?` |
| GET    | `/users/me`             | any account | Your profile, including `role` and `status` |
| PATCH  | `/users/me`             | any account | Update `name`, `photo_url`, `birth_year`, `hobbies` |
| DELETE | `/users/me`             | any account | Delete your account and sign-ups (activities you created stay) |
| GET    | `/users/me/activities`  | approved | "Mis planes": upcoming activities you have a place in or are waiting for, including cancelled ones |

### Activities

| Method | Path                                 | Who | Description |
| ------ | ------------------------------------ | --- | ----------- |
| GET    | `/activities`                        | approved | `?month=YYYY-MM` for a whole month (calendar), otherwise upcoming. Optional `category`. Members see published and cancelled; admins also see drafts |
| GET    | `/activities/:id`                    | approved | One activity, with who is going |
| PUT    | `/activities/:id/registration`       | participants, volunteers | Sign up in the quota for your role, or join its waiting list when full |
| DELETE | `/activities/:id/registration`       | participants, volunteers | Give up your place or leave the waiting list. A freed place goes to the first person waiting |
| POST   | `/activities`                        | admins | Create (`201`) |
| PATCH  | `/activities/:id`                    | admins | Edit any field, including `status`. More places move the waiting list up |
| DELETE | `/activities/:id`                    | admins | Delete (prefer `status: "cancelled"` once published) |
| PUT    | `/activities/:id/image?consent=true` | admins | Add or replace the photo, see below |
| DELETE | `/activities/:id/image`              | admins | Remove the photo |

Create body:

```json
{
  "title": "Cine en Granada",
  "category": "culturales",
  "description": "Vamos juntos al cine. Después tomamos algo.",
  "date_time": "2026-11-07T17:00",
  "location_name": "Cines Kinépolis, Pulianas",
  "meeting_point": "Puerta del cine, 16:45",
  "transport": "Autobús 9",
  "price": 6,
  "participant_places": 10,
  "volunteer_places": 3,
  "status": "published"
}
```

- `category`: `culturales`, `deportes` or `juegos`.
- `status`: `draft` (default, only admins see it), `published` or `cancelled`.
- `price`: shown only, there are no payments. `null` or `0` means free.
- `meeting_point` and `transport` are optional.
- `date_time`: without an offset it is read in `APP_TIMEZONE`
  (Europe/Madrid). Responses use local time with the offset, e.g.
  `2026-11-07T17:00:00+01:00`.

An activity in a response:

```json
{
  "id": 1,
  "title": "Cine en Granada",
  "category": "culturales",
  "description": "Vamos juntos al cine. Después tomamos algo.",
  "date_time": "2026-11-07T17:00:00+01:00",
  "location_name": "Cines Kinépolis, Pulianas",
  "meeting_point": "Puerta del cine, 16:45",
  "transport": "Autobús 9",
  "price": 6,
  "status": "published",
  "participants": { "places": 10, "confirmed": 4, "waiting": 0 },
  "volunteers": { "places": 3, "confirmed": 1, "waiting": 0 },
  "my_registration": { "quota": "participant", "status": "waiting", "position": 2 },
  "image_path": null,
  "going": {
    "participants": [{ "id": "auth0|123", "name": "María", "photo_url": null }],
    "volunteers": [{ "id": "auth0|456", "name": "Lucía", "photo_url": null }]
  }
}
```

- `my_registration` is `null` if you have not signed up. `position` is your
  place in the waiting list (only while `status` is `waiting`).
- `going` (only for a single activity) lists people with a place. Members only
  ever see each other's name and photo, never email, age or hobbies.
- `image_path` is `null` when there is no photo, otherwise a temporary signed
  link (see below).

Sign-up errors (`409`): `activity_cancelled`, `activity_past`,
`no_places_for_role` (e.g. a volunteer when the activity needs none).

### Admin

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET    | `/admin/users?status=pending` | Accounts, pending first. `status` is optional |
| PATCH  | `/admin/users/:userId` | Set `role` and/or `status` (`pending`, `approved`, `blocked`). You cannot change your own |
| GET    | `/admin/activities/:id/registrations` | Everyone signed up, by quota, in order, with email |
| DELETE | `/admin/activities/:id/registrations/:userId` | Remove someone; the waiting list moves up |

### Activity photos

Upload the photo as the raw request body, not as JSON or a form:

```
PUT /activities/7/image?consent=true
Content-Type: image/webp        (or image/jpeg, image/png, image/heic, image/avif)
<binary image, max 5 MB>
```

- `consent=true` records that the admin confirmed the people in the photo
  agree to it being published. Without it the API answers `400`
  (`consent_required`).
- The server re-encodes every upload with [sharp](https://sharp.pixelplumbing.com/):
  rotated upright, at most 1280 px on the longest side, WebP, and with all
  metadata (EXIF, GPS location) removed. A phone photo ends up around
  50–200 KB. It is stored in the `activity_images` table.

Photos are shown with plain `<img>` tags, which cannot send the login token,
so activities include an `image_path` such as
`/activities/7/image?v=…&expires=…&sig=…`. The link is signed with
`IMAGE_URL_SECRET`, expires after 3–6 hours, and stops working when the photo
is replaced or removed. Prefix it with the API's base URL to display it.

### Health

`GET /health` → `{ "status": "ok" }`, or `503` if the database is unreachable.

## Project structure

```
src/
  app.js            Express app (security headers, CORS, rate limit, routes)
  server.js         Starts the HTTP server
  config.js         Reads environment variables
  schemas.js        Request validation (zod)
  db/               Connection pool, migrations, seed and reset scripts
  middleware/       Auth0 token check and error handling
  models/           SQL queries
  routes/           HTTP endpoints
test/               API tests against a real database
```
