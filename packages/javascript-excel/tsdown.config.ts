import { defineConfig, type UserConfig } from "tsdown";

// `isolatedDeclarations` (tsconfig) makes tsdown emit .d.ts with Oxc, so the
// declaration build does not depend on the TypeScript compiler API. It also
// means every export needs an explicit type, including this one.
const config: UserConfig = defineConfig({
  entry: {
    index: "src/index.ts",
    read: "src/read.ts",
    csv: "src/csv.ts",
    dom: "src/dom.ts",
    worker: "src/worker.ts",
    format: "src/format.ts",
    import: "src/import.ts",
  },
  format: ["esm", "cjs"],
  platform: "neutral",
  target: "es2022",
  dts: true,
  sourcemap: false,
  clean: true,
});

export default config;
