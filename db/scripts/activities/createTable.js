import db from "../../connection";

const response = await db.query(`
  CREATE TABLE IF NOT EXISTS activities 
  (activity_id SERIAL PRIMARY KEY,
   organizer_id TEXT NOT NULL REFERENCES users(user_id),
   location_name TEXT NOT NULL,
   max_attendees INT NOT NULL, date_time timestamp NOT NULL,
   description TEXT NOT NULL,
   type TEXT NOT NULL);`
);

console.log(response);
db.end();