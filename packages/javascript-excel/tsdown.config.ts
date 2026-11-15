import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    read: "src/read.ts",
    csv: "src/csv.ts",
    dom: "src/dom.ts",
    worker: "src/worker.ts",
  },
  format: ["esm", "cjs"],
  platform: "neutral",
  target: "es2022",
  dts: true,
  sourcemap: false,
  clean: true,
});
