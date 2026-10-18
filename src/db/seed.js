import { pathToFileURL } from "node:url";
import { config } from "../config.js";
import { pool, withTransaction } from "./pool.js";

// Sample data matching the front end's demo content, dated in the future.
const users = [
  { id: "seed|pepe", name: "Pepe", hobbies: "Pasear, ajedrez y pescar", birth_year: 1991 },
  { id: "seed|maria", name: "María" },
  { id: "seed|juan", name: "Juan" },
  { id: "seed|marcos", name: "Marcos" },
];

const activities = [
  {
    organiser: "seed|pepe",
    title: "Visita a la iglesia de San Martín",
    category: "culturales",
    type: "museum",
    location_name: "Calle San Miguel, 43, Granada",
    days: 7,
    time: "18:00",
    max_attendees: 10,
    description:
      "Visitamos la iglesia de San Martín. Una guía nos cuenta su historia. Después tomamos algo juntos.",
    attendees: ["seed|maria", "seed|juan"],
  },
  {
    organiser: "seed|maria",
    title: "Ruta del Mamut",
    category: "deportes",
    type: "walk",
    location_name: "Plaza Nueva, Granada",
    days: 14,
    time: "10:00",
    max_attendees: 12,
    description:
      "Hacemos una ruta andando por el campo. Es fácil y dura unas 2 horas. Trae agua y zapatillas cómodas.",
    attendees: ["seed|marcos"],
  },
  {
    organiser: "seed|juan",
    title: "Subida a la Cruz de la Atalaya",
    category: "deportes",
    type: "walk",
    location_name: "Fuente de la plaza, Granada",
    days: 21,
    time: "09:30",
    max_attendees: 8,
    description:
      "Subimos andando a la Cruz de la Atalaya. Desde arriba se ve todo el pueblo. Paramos a descansar cuando haga falta.",
    attendees: ["seed|pepe"],
  },
  {
    organiser: "seed|marcos",
    title: "Tarde de juegos de mesa",
    category: "juegos",
    type: "other",
    location_name: "Centro cívico, Calle Real, 12, Granada",
    days: 28,
    time: "17:00",
    max_attendees: 8,
    description: "Jugamos al parchís, al dominó y a las cartas. Si no sabes jugar, te enseñamos.",
    attendees: ["seed|pepe", "seed|juan"],
  },
];

export async function seed() {
  if (config.env === "production") {
    throw new Error("Refusing to seed the database in production");
  }

  await withTransaction(async (client) => {
    await client.query("TRUNCATE users, activities, attendees, interests RESTART IDENTITY CASCADE");

    for (const user of users) {
      await client.query(
        "INSERT INTO users (user_id, name, birth_year, hobbies) VALUES ($1, $2, $3, $4)",
        [user.id, user.name, user.birth_year ?? null, user.hobbies ?? null]
      );
    }

    for (const activity of activities) {
      const { rows } = await client.query(
        `INSERT INTO activities
           (organiser_id, title, category, type, location_name, date_time, description, max_attendees)
         VALUES ($1, $2, $3, $4, $5, (current_date + $6::int + $7::time)::timestamp, $8, $9)
         RETURNING activity_id`,
        [
          activity.organiser,
          activity.title,
          activity.category,
          activity.type,
          activity.location_name,
          activity.days,
          activity.time,
          activity.description,
          activity.max_attendees,
        ]
      );
      for (const userId of [activity.organiser, ...activity.attendees]) {
        await client.query("INSERT INTO attendees (activity_id, user_id) VALUES ($1, $2)", [
          rows[0].activity_id,
          userId,
        ]);
      }
    }
  });
  console.log(`Seeded ${users.length} users and ${activities.length} activities`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await seed();
  } finally {
    await pool.end();
  }
}
