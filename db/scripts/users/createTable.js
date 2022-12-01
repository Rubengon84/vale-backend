import db from "../../connection.js";

const response = await db.query(
  `CREATE TABLE IF NOT EXISTS users 
  (user_id SERIAL TEXT PRIMARY KEY,
   user_email TEXT NOT NULL, 
   user_name TEXT ,
   user_last_names TEXT,
   user_phone NUMBER);`
);

console.log(response);

db.end();
