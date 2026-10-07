// Local verification only. Production always uses the owner-supplied Neon DATABASE_URL.
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
const db = await PGlite.create("test-results/postgres");
const server = new PGLiteSocketServer({ db, port: 55432, host: "127.0.0.1", maxConnections: 10 });
await server.start();
console.log("Isolated local PostgreSQL test server: 127.0.0.1:55432");
async function stop() {
  await server.stop();
  await db.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
