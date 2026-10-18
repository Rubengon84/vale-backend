import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgres://vale:vale@localhost:5432/vale_test",
      AUTH0_DOMAIN: "vale-test.example.com",
      AUTH0_AUDIENCE: "https://api.vale.test",
    },
    globalSetup: "./test/globalSetup.js",
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
  },
});
