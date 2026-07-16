import path from "node:path";
import { createApp } from "./app.mjs";

const port = Number(process.env.OUTPOST_PORT ?? 3002);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("OUTPOST_PORT geçerli bir port olmalı");
  process.exit(1);
}

const vaultPath = path.resolve(process.env.OUTPOST_VAULT ?? "./data/vault");
const app = await createApp({ vaultPath, watch: true, logger: true });

try {
  await app.listen({ port, host: "127.0.0.1" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
