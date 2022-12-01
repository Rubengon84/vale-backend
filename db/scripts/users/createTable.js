import db from "../../connection.js";

const response = await db.query(
  `CREATE TABLE IF NOT EXISTS users 
  (user_id TEXT PRIMARY KEY,
   user_email TEXT NOT NULL, 
   user_name TEXT,
   user_last_names TEXT,
   user_phone TEXT);`
);

console.log(response);

db.end();
