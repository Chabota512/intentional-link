import { createServer } from "http";
import app from "./app";
import { initSocketIO } from "./lib/socketio";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);

initSocketIO(httpServer);

httpServer.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
