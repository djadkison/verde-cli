import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  minify: false,
  // No runtime dependencies — everything the CLI needs is in Node's stdlib.
  // The bundle is the whole install.
  banner: { js: "#!/usr/bin/env node" },
});
