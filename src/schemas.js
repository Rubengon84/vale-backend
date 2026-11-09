import { z } from "zod";
import { containsEmail, safeDisplayName } from "./names.js";

export const CATEGORIES = ["culturales", "deportes", "juegos"];

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
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected a month like 2026-11")
    .optional(),
  category: z.enum(CATEGORIES).optional(),
});

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === "" ? null : value));

export const ACTIVITY_STATUSES = ["draft", "published", "cancelled"];

export const createActivityBody = z.object({
  title: text(120),
  category: z.enum(CATEGORIES),
  description: text(2000),
  date_time: dateTime,
  location_name: text(200),
  meeting_point: optionalText(200),
  transport: optionalText(200),
  // Shown only; there are no payments in the app. null or 0 means free.
  price: z.coerce.number().min(0).max(100000).nullable().optional(),
  participant_places: z.coerce.number().int().min(0).max(500),
  volunteer_places: z.coerce.number().int().min(0).max(200),
  status: z.enum(ACTIVITY_STATUSES).optional(),
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
    email_notifications: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");

export const ROLES = ["participant", "volunteer", "admin"];

export const adminUsersQuery = z.object({
  status: z.enum(["pending", "approved", "blocked"]).optional(),
});

export const adminUserUpdateBody = z
  .object({
    role: z.enum(ROLES),
    status: z.enum(["pending", "approved", "blocked"]),
    // Pause (or un-pause) the person's chat messages
    chat_muted: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");

export const userIdParam = z.object({ userId: z.string().min(1).max(200) });

// ---------- Ideas ----------

export const createIdeaBody = z.object({
  title: text(200),
  description: optionalText(2000),
  suggested_when: optionalText(100),
});

export const IDEA_STATUSES = ["received", "considering", "approved", "declined"];

export const ideaListQuery = z.object({
  scope: z.enum(["mine", "community"]).default("mine"),
});

export const adminIdeasQuery = z.object({
  status: z.enum(IDEA_STATUSES).optional(),
});

export const reviewIdeaBody = z
  .object({
    status: z.enum(IDEA_STATUSES),
    response: optionalText(1000),
    activity_id: z.coerce.number().int().positive().nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");

// ---------- Chats ----------

export const chatRoomParam = z.object({ room: z.string().max(30) });

export const chatMessagesQuery = z.object({
  after: z.coerce.number().int().min(0).optional(),
  before: z.coerce.number().int().positive().optional(),
});

export const chatMessageBody = z.object({ body: text(1000) });

export const chatReportBody = z.object({ reason: optionalText(500) });

export const chatReportsQuery = z.object({
  status: z.enum(["open", "all"]).default("open"),
});

export const chatMessageUpdateBody = z.object({ hidden: z.boolean() });
