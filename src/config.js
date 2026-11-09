const env = process.env;

export const config = {
  env: env.NODE_ENV ?? "development",
  port: Number(env.PORT ?? 4000),
  databaseUrl: env.DATABASE_URL,
  // Times without an explicit offset are read in this zone, and returned in it.
  timezone: env.APP_TIMEZONE ?? "Europe/Madrid",
  corsOrigins: (env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  trustProxy: env.TRUST_PROXY === "true",
  // Per IP address. Members using the app together on the association's
  // Wi-Fi share one address, so this is generous.
  rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 600),
  // Signs the temporary links used to show activity photos.
  imageUrlSecret: env.IMAGE_URL_SECRET,
  email: {
    // Resend (resend.com). Without a key, emails are only logged.
    resendApiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM ?? "VALE Conecta <onboarding@resend.dev>",
  },
  // The front end's address, for links in emails
  appUrl: (env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  // Protects POST /internal/jobs (reminders, chat clean-up) for an external timer
  cronSecret: env.CRON_SECRET,
  auth0: {
    domain: env.AUTH0_DOMAIN,
    audience: env.AUTH0_AUDIENCE,
  },
};

export function assertConfig(...keys) {
  const missing = keys.filter((key) => {
    const value = key.split(".").reduce((object, part) => object?.[part], config);
    return !value;
  });
  if (missing.length > 0) {
    throw new Error(`Missing configuration: ${missing.join(", ")}`);
  }
}
