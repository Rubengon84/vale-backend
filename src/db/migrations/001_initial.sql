CREATE TABLE users (
  user_id     TEXT PRIMARY KEY,               -- Auth0 "sub" claim
  name        TEXT NOT NULL,
  email       TEXT,
  photo_url   TEXT,
  birth_year  INT CHECK (birth_year BETWEEN 1900 AND 2100),
  hobbies     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE activities (
  activity_id    INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organiser_id   TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  category       TEXT NOT NULL CHECK (category IN ('culturales', 'deportes', 'juegos')),
  type           TEXT NOT NULL,
  location_name  TEXT NOT NULL,
  date_time      TIMESTAMPTZ NOT NULL,
  description    TEXT NOT NULL,
  max_attendees  INT NOT NULL CHECK (max_attendees > 0),
  cost           NUMERIC(8, 2) CHECK (cost >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX activities_date_time_idx ON activities (date_time);
CREATE INDEX activities_category_date_time_idx ON activities (category, date_time);
CREATE INDEX activities_organiser_idx ON activities (organiser_id);

-- People going to an activity. The organiser is always one of them.
CREATE TABLE attendees (
  activity_id  INT NOT NULL REFERENCES activities (activity_id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, user_id)
);

CREATE INDEX attendees_user_idx ON attendees (user_id);

-- Activities a user marked with "Me gusta".
CREATE TABLE interests (
  activity_id  INT NOT NULL REFERENCES activities (activity_id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, user_id)
);

CREATE INDEX interests_user_idx ON interests (user_id);
