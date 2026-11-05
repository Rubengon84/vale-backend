import { pathToFileURL } from "node:url";
import { config } from "../config.js";
import { pool, withTransaction } from "./pool.js";

// Sample data for development and test sites, dated in the future.
const users = [
  { id: "seed|equipo", name: "Equipo VALE", role: "admin" },
  { id: "seed|pepe", name: "Pepe", role: "participant", hobbies: "Pasear, ajedrez y pescar" },
  { id: "seed|maria", name: "María", role: "participant" },
  { id: "seed|juan", name: "Juan", role: "participant" },
  { id: "seed|lucia", name: "Lucía", role: "volunteer" },
  { id: "seed|marcos", name: "Marcos", role: "volunteer" },
];

const activities = [
  {
    title: "Cine en Granada",
    category: "culturales",
    days: 5,
    time: "17:00",
    location_name: "Cines Kinépolis, Pulianas",
    meeting_point: "Puerta del cine, 16:45",
    transport: "Autobús 9 hasta la parada Kinépolis",
    price: 6,
    participant_places: 10,
    volunteer_places: 3,
    description:
      "Vamos juntos al cine. Elegimos una película divertida. Después tomamos algo y hablamos de la película.",
    participants: ["seed|pepe", "seed|maria"],
    volunteers: ["seed|lucia"],
  },
  {
    title: "Ruta por el valle",
    category: "deportes",
    days: 12,
    time: "10:00",
    location_name: "Sendero del río Monachil",
    meeting_point: "Plaza Nueva, 9:30",
    transport: "Vamos en furgoneta de la asociación",
    price: 0,
    participant_places: 2,
    volunteer_places: 2,
    description:
      "Hacemos una ruta andando junto al río. Es fácil y dura unas 2 horas. Trae agua y zapatillas cómodas.",
    participants: ["seed|juan", "seed|maria"],
    volunteers: ["seed|marcos"],
  },
  {
    title: "Tarde de juegos de mesa",
    category: "juegos",
    days: 19,
    time: "17:30",
    location_name: "Centro cívico, Calle Real, 12",
    meeting_point: null,
    transport: null,
    price: null,
    participant_places: 8,
    volunteer_places: 2,
    description: "Jugamos al parchís, al dominó y a las cartas. Si no sabes jugar, te enseñamos.",
    participants: [],
    volunteers: [],
  },
];

export async function seed() {
  if (config.env === "production") {
    throw new Error("Refusing to seed the database in production");
  }

  await withTransaction(async (client) => {
    await client.query("TRUNCATE users, activities, registrations RESTART IDENTITY CASCADE");

    for (const user of users) {
      await client.query(
        `INSERT INTO users (user_id, name, role, status, hobbies)
         VALUES ($1, $2, $3, 'approved', $4)`,
        [user.id, user.name, user.role, user.hobbies ?? null]
      );
    }

    for (const activity of activities) {
      const { rows } = await client.query(
        `INSERT INTO activities
           (created_by, title, category, date_time, location_name, meeting_point, transport,
            price, participant_places, volunteer_places, description, status)
         VALUES ('seed|equipo', $1, $2, (current_date + $3::int + $4::time)::timestamp,
                 $5, $6, $7, $8, $9, $10, $11, 'published')
         RETURNING activity_id`,
        [
          activity.title,
          activity.category,
          activity.days,
          activity.time,
          activity.location_name,
          activity.meeting_point,
          activity.transport,
          activity.price,
          activity.participant_places,
          activity.volunteer_places,
          activity.description,
        ]
      );
      const register = (userId, quota) =>
        client.query(
          `INSERT INTO registrations (activity_id, user_id, quota, status)
           VALUES ($1, $2, $3, 'confirmed')`,
          [rows[0].activity_id, userId, quota]
        );
      for (const userId of activity.participants) await register(userId, "participant");
      for (const userId of activity.volunteers) await register(userId, "volunteer");
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
