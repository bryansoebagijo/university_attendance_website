import { createApp } from "./app.js";
import { config } from "./config.js";
import { startScheduler } from "./jobs/scheduler.js";

createApp().listen(config.PORT, () => {
  console.log(`Backend listening on http://localhost:${config.PORT}`);
  startScheduler();
});
