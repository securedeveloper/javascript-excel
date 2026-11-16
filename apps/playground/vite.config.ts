import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Resolve the workspace package to its TypeScript sources, so `npm run dev`
// needs no prior package build and always matches the branch. The packed
// tarball (what npm users get) is covered by the package's smoke test.
const src = fileURLToPath(new URL("../../packages/javascript-excel/src/", import.meta.url));

// `vite preview` serves the same security headers as Vercel (vercel.json), so the
// CSP is exercised locally before a deploy.
const vercel = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8")) as { headers: Array<{ headers: Array<{ key: string; value: string }> }> };
const headers = Object.fromEntries(vercel.headers.flatMap((h) => h.headers.map(({ key, value }) => [key, value])));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^javascript-excel$/, replacement: `${src}index.ts` },
      { find: /^javascript-excel\/(.+)$/, replacement: `${src}$1.ts` },
    ],
  },
  worker: { format: "es" },
  preview: { headers },
});
