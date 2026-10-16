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

## API

Responses are JSON. Errors look like
`{ "error": "Human readable message", "code": "machine_code" }`; validation
errors add `details`.

### Users

| Method | Path                    | Description                                                  |
| ------ | ----------------------- | ------------------------------------------------------------ |
| PUT    | `/users/me`             | Register on first login (`201`), or refresh the email (`200`). Body: `name`, `email?`, `photo_url?` |
| GET    | `/users/me`             | Your profile                                                 |
| PATCH  | `/users/me`             | Update `name`, `photo_url`, `birth_year`, `hobbies`          |
| DELETE | `/users/me`             | Delete your account, your activities and your sign-ups       |
| GET    | `/users/me/activities`  | Your upcoming activities. `?role=attending` (default) or `organiser` |
| GET    | `/users/me/interests`   | Upcoming activities you marked "Me gusta"                    |

### Activities

| Method | Path                                | Description                                       |
| ------ | ----------------------------------- | ------------------------------------------------- |
| GET    | `/activities`                       | Upcoming activities. Filters: `category`, `type`, `location`, `date` (YYYY-MM-DD) |
| POST   | `/activities`                       | Create (`201`). You become the first attendee      |
| GET    | `/activities/:id`                   | One activity, with the people going               |
| PATCH  | `/activities/:id`                   | Edit (organiser only)                             |
| DELETE | `/activities/:id`                   | Cancel (organiser only)                           |
| PUT    | `/activities/:id/participants/me`   | Join. `409` if full (`activity_full`) or past (`activity_past`) |
| DELETE | `/activities/:id/participants/me`   | Leave (the organiser cannot leave)                |
| PUT    | `/activities/:id/interest`          | Mark "Me gusta"                                   |
| DELETE | `/activities/:id/interest`          | Remove "Me gusta"                                 |

Create body:

```json
{
  "title": "Ruta del Mamut",
  "category": "deportes",
  "type": "walk",
  "location_name": "Plaza Nueva, Granada",
  "date_time": "2026-11-21T10:00",
  "description": "Ruta fácil por el campo.",
  "max_attendees": 12,
  "cost": null
}
```

- `category`: `culturales`, `deportes` or `juegos`.
- `type`: one of the options in the front end's form (see `src/schemas.js`).
- `date_time`: without an offset it is read in `APP_TIMEZONE`
  (Europe/Madrid). Responses use local time with the offset, e.g.
  `2026-11-21T10:00:00+01:00`.

An activity in a response:

```json
{
  "id": 1,
  "title": "Ruta del Mamut",
  "category": "deportes",
  "type": "walk",
  "location_name": "Plaza Nueva, Granada",
  "date_time": "2026-11-21T10:00:00+01:00",
  "description": "Ruta fácil por el campo.",
  "max_attendees": 12,
  "cost": null,
  "organiser": { "id": "auth0|123", "name": "María", "photo_url": null },
  "attendee_count": 2,
  "is_attending": true,
  "is_interested": false,
  "is_organiser": false,
  "attendees": [{ "id": "auth0|123", "name": "María", "photo_url": null }]
}
```

`attendees` is only included for a single activity. Other members only ever
see each other's name and photo, never email, age or hobbies.

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
