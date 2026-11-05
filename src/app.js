import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.js";
import { currentUser, jwtAuth, loadUser, requireAdmin, requireApproved } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import healthRouter from "./routes/health.js";
import usersRouter from "./routes/users.js";
import activitiesRouter from "./routes/activities.js";
import { imagesRouter, publicActivityImagesRouter } from "./routes/images.js";
import adminRouter from "./routes/admin.js";
import ideasRouter, { publicIdeaImagesRouter } from "./routes/ideas.js";

// `authenticate` can be replaced in tests; in the app it verifies Auth0 tokens.
export function createApp({ authenticate = jwtAuth() } = {}) {
  const app = express();

  app.set("trust proxy", config.trustProxy);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins }));
  if (config.env !== "test") {
    app.use(morgan(config.env === "production" ? "combined" : "dev"));
  }
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: config.rateLimitPerMinute,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    })
  );
  app.use(express.json({ limit: "20kb" }));

  app.use("/health", healthRouter);
  app.use("/activities", publicActivityImagesRouter);
  app.use("/ideas", publicIdeaImagesRouter);

  app.use(authenticate, currentUser);
  app.use("/users", usersRouter);
  app.use("/activities", loadUser, requireApproved, imagesRouter, activitiesRouter);
  app.use("/ideas", loadUser, requireApproved, ideasRouter);
  app.use("/admin", loadUser, requireApproved, requireAdmin, adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
