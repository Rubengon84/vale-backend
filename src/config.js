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
  // Signs the temporary links used to show activity photos.
  imageUrlSecret: env.IMAGE_URL_SECRET,
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
