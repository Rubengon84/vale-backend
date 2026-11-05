-- VALE Conecta, phase 1B: members propose activities ("Mis ideas") and the
-- VALE team reviews them.

CREATE TABLE ideas (
  idea_id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_id       TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  title           TEXT NOT NULL,          -- "¿Qué te gustaría hacer?"
  description     TEXT,                   -- "Cuéntanos más"
  suggested_when  TEXT,                   -- "¿Cuándo?", free text such as "en primavera"
  -- received: only the author and the team see it
  -- considering / approved: the team reviewed it and everyone can see it
  -- declined: only the author and the team see it, with the team's reply
  status          TEXT NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received', 'considering', 'approved', 'declined')),
  response        TEXT,                   -- the team's reply to the author
  activity_id     INT REFERENCES activities (activity_id) ON DELETE SET NULL,
  reviewed_by     TEXT REFERENCES users (user_id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ideas_status_idx ON ideas (status, created_at);
CREATE INDEX ideas_author_idx ON ideas (author_id);

-- "Me gustaría participar"
CREATE TABLE idea_interest (
  idea_id     INT NOT NULL REFERENCES ideas (idea_id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (idea_id, user_id)
);

CREATE INDEX idea_interest_user_idx ON idea_interest (user_id);

-- Optional photo, re-encoded by the server like activity photos.
CREATE TABLE idea_images (
  idea_id               INT PRIMARY KEY REFERENCES ideas (idea_id) ON DELETE CASCADE,
  data                  BYTEA NOT NULL CHECK (octet_length(data) <= 1048576),
  width                 INT NOT NULL,
  height                INT NOT NULL,
  consent_confirmed_at  TIMESTAMPTZ NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
