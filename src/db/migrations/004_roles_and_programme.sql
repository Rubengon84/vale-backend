-- VALE Conecta, phase 1A: the association publishes the programme and
-- participants and volunteers sign up in separate quotas.
-- Agreed with the association: activities created during testing are removed,
-- and existing accounts must be approved again with a role.

-- Roles and account approval
ALTER TABLE users
  ADD COLUMN role TEXT NOT NULL DEFAULT 'participant'
    CHECK (role IN ('participant', 'volunteer', 'admin')),
  ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'blocked'));

-- Member-created activities, attendance and "Me gusta" are replaced
DROP TABLE interests;
DROP TABLE attendees;
DELETE FROM activities;

ALTER TABLE activities RENAME COLUMN organiser_id TO created_by;
ALTER TABLE activities ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE activities DROP CONSTRAINT activities_organiser_id_fkey;
ALTER TABLE activities
  ADD CONSTRAINT activities_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users (user_id) ON DELETE SET NULL;

ALTER TABLE activities RENAME COLUMN cost TO price;
ALTER TABLE activities
  DROP COLUMN type,
  DROP COLUMN max_attendees,
  ADD COLUMN meeting_point TEXT,
  ADD COLUMN transport TEXT,
  ADD COLUMN participant_places INT NOT NULL CHECK (participant_places >= 0),
  ADD COLUMN volunteer_places INT NOT NULL CHECK (volunteer_places >= 0),
  ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'cancelled'));

DROP INDEX activities_organiser_idx;
CREATE INDEX activities_status_date_time_idx ON activities (status, date_time);

-- Sign-ups. The quota follows the person's role; when a quota is full people
-- join its waiting list, in order of arrival.
CREATE TABLE registrations (
  activity_id  INT NOT NULL REFERENCES activities (activity_id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  quota        TEXT NOT NULL CHECK (quota IN ('participant', 'volunteer')),
  status       TEXT NOT NULL CHECK (status IN ('confirmed', 'waiting')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, user_id)
);

CREATE INDEX registrations_queue_idx ON registrations (activity_id, quota, status, created_at);
CREATE INDEX registrations_user_idx ON registrations (user_id);
