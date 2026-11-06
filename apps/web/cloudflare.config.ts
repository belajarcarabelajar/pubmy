import { defineConfig } from "cf/config";

// Static assets only: no entrypoint, so every request is served from the assets directory.
// cf 1.0.0-beta.5 has no assets-directory field here; its autoconfig writes that path to a
// companion wrangler.config.ts (assetsDirectory "./dist") and builds through wrangler.
export default defineConfig({
  worker: {
    name: "pubmy",
    compatibilityDate: "2026-11-07",
    domains: ["pubmy.belajarcarabelajar.com"],
  },
});
