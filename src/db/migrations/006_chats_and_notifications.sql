-- VALE Conecta, phase 1C: moderated group chats and email notifications.

-- Chat rooms are fixed: 'community' (everyone), 'participants' and
-- 'volunteers' (that group plus the VALE team). Text and emoji only.
CREATE TABLE chat_messages (
  message_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room        TEXT NOT NULL CHECK (room IN ('community', 'participants', 'volunteers')),
  author_id   TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Hidden by the VALE team: kept for review, not shown to members
  hidden_at   TIMESTAMPTZ,
  hidden_by   TEXT REFERENCES users (user_id) ON DELETE SET NULL
);

CREATE INDEX chat_messages_room_idx ON chat_messages (room, message_id);
CREATE INDEX chat_messages_created_idx ON chat_messages (created_at);

CREATE TABLE chat_reports (
  report_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id   BIGINT NOT NULL REFERENCES chat_messages (message_id) ON DELETE CASCADE,
  reporter_id  TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  resolved_by  TEXT REFERENCES users (user_id) ON DELETE SET NULL,
  UNIQUE (message_id, reporter_id)
);

CREATE INDEX chat_reports_open_idx ON chat_reports (resolved_at, created_at);

ALTER TABLE users
  -- Shown the chat rules and accepted them
  ADD COLUMN chat_rules_accepted_at TIMESTAMPTZ,
  -- Paused by the VALE team: can read but not write
  ADD COLUMN chat_muted_at TIMESTAMPTZ,
  -- Emails about activities, ideas and the account (they can turn it off)
  ADD COLUMN email_notifications BOOLEAN NOT NULL DEFAULT TRUE;

-- Reminder emails are sent once per activity, the day before
ALTER TABLE activities ADD COLUMN reminder_sent_at TIMESTAMPTZ;
