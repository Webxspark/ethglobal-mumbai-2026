import { createHttpServer } from "./http.js";
import { loadRootEnv } from "./load-root-env.js";
import { bootRuntime } from "./runtime.js";

// Shell exports win; fill the rest from repo-root `.env` (Alan shouldn't fish-export).
const rootEnv = loadRootEnv(import.meta.url);
if (rootEnv.loaded) {
  console.log(
    `proofwork mcp: loaded root .env (${rootEnv.keys.length} new keys) from ${rootEnv.path}`,
  );
} else {
  console.log(`proofwork mcp: no root .env at ${rootEnv.path}`);
}

const runtime = await bootRuntime(process.env);
createHttpServer({
  tools: runtime.tools,
  ports: runtime.ports,
  port: runtime.env.port,
  session: runtime.session,
}).listen();
