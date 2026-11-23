// Point every test at the separate absen_test database (loaded before src/config.ts).
import dotenv from "dotenv";

// TEST_ENV_FILE=.env.test.mysql runs the same tests against MySQL.
dotenv.config({ path: process.env.TEST_ENV_FILE ?? ".env.test", override: true });
