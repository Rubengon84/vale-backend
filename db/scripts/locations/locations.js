import db from "../../connection";
const response = await db.query(`
  CREATE TABLE IF NOT EXISTS locations 
  (location_id SERIAL PRIMARY KEY,
   location_name TEXT NOT NULL);`
);

console.log(response);
db.end();