import db from "../../connection.js";

const response = await db.query(`
  CREATE TABLE IF NOT EXISTS activities 
  (activity_id SERIAL PRIMARY KEY,
   organizer_id TEXT NOT NULL REFERENCES users(user_id),
   activity_title TEXT NOT NULL,
   location_name TEXT NOT NULL,
   max_attendees INT NOT NULL, 
   date_time timestamp NOT NULL,
   description TEXT NOT NULL,
   activity_cost INT,
   type TEXT NOT NULL);`);

console.log(response);
db.end();
