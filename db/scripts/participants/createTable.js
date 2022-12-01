import db from "../../connection";

const response = await db.query(`
  CREATE TABLE IF NOT EXISTS participants
  (participants_id SERIAL PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(user_id),
    participant_role TEXT NOT NULL,
    UNIQUE (user_id, activity_id));`
);

console.log(response);
db.end();