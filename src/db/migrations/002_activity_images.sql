-- One photo per activity, re-encoded by the server as WebP (see src/images.js).
CREATE TABLE activity_images (
  activity_id           INT PRIMARY KEY REFERENCES activities (activity_id) ON DELETE CASCADE,
  data                  BYTEA NOT NULL CHECK (octet_length(data) <= 1048576),
  width                 INT NOT NULL,
  height                INT NOT NULL,
  -- The organiser confirmed that the people in the photo agree to it.
  consent_confirmed_at  TIMESTAMPTZ NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
