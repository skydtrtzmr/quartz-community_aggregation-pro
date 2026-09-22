import { defineConfig } from "tsup"

export default defineConfig({
  entry: { index: "src/index.ts", types: "src/types.ts" },
  format: ["esm"],
  target: "es2022",
  platform: "node",
  dts: true,
  clean: true,
  splitting: false,
  // Bundle the path helpers; Quartz loads plugins without resolving sibling internals.
  noExternal: ["@quartz-community/utils"],
})
