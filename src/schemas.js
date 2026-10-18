import { z } from "zod";
import { containsEmail, safeDisplayName } from "./names.js";

export const CATEGORIES = ["culturales", "deportes", "juegos"];

// Must match the options in the front end's create form.
export const ACTIVITY_TYPES = [
  "arts/crafts",
  "cafe",
  "cinema",
  "cycle",
  "gallery",
  "karaoke",
  "museum",
  "restaurant",
  "run",
  "swim",
  "tennis",
  "theatre",
  "walk",
  "other",
];

const text = (max) => z.string().trim().min(1).max(max);

// "2026-11-14T18:00" (read in APP_TIMEZONE) or a full ISO string with offset.
const dateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/,
    "Expected a date and time like 2026-11-14T18:00"
  );

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const activityFilters = z.object({
  category: z.enum(CATEGORIES).optional(),
  type: z.enum(ACTIVITY_TYPES).optional(),
  location: z.string().trim().max(100).optional(),
  date: z.iso.date().optional(),
});

export const createActivityBody = z.object({
  title: text(120),
  category: z.enum(CATEGORIES),
  type: z.enum(ACTIVITY_TYPES),
  location_name: text(200),
  date_time: dateTime,
  description: text(2000),
  max_attendees: z.coerce.number().int().min(1).max(500),
  cost: z.coerce.number().min(0).max(100000).nullable().optional(),
});

export const updateActivityBody = createActivityBody
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");

const photoUrl = z.url({ protocol: /^https$/ }).max(500);

export const registerUserBody = z.object({
  name: text(254).transform(safeDisplayName).pipe(text(100)),
  email: z.email().max(254).optional(),
  photo_url: photoUrl.optional(),
});

export const updateUserBody = z
  .object({
    name: text(100).refine((name) => !containsEmail(name), "The name cannot contain an email address"),
    photo_url: photoUrl.nullable(),
    birth_year: z.coerce.number().int().min(1900).max(new Date().getFullYear()).nullable(),
    hobbies: z.string().trim().max(500).nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");

export const myActivitiesQuery = z.object({
  role: z.enum(["attending", "organiser"]).default("attending"),
});
