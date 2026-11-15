import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Resolve the workspace package to its TypeScript sources, so `npm run dev`
// needs no prior package build and always matches the branch. The packed
// tarball (what npm users get) is covered by the package's smoke test.
const src = fileURLToPath(new URL("../../packages/javascript-excel/src/", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^javascript-excel$/, replacement: `${src}index.ts` },
      { find: /^javascript-excel\/(.+)$/, replacement: `${src}$1.ts` },
    ],
  },
});
