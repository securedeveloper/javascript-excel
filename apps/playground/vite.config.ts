import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Resolve the workspace package to its TypeScript sources, so `npm run dev`
// needs no prior package build and always matches the branch. The packed
// tarball (what npm users get) is covered by the package's smoke test.
const src = fileURLToPath(new URL("../../packages/javascript-excel/src/", import.meta.url));

// `vite preview` serves a strict Content-Security-Policy and the other security
// headers (they used to live in vercel.json), so the sandbox and its tests
// exercise the CSP. This app is not deployed; the public playground,
// securedeveloper/javascript-excel-playground, sets its own headers.
const headers: Record<string, string> = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
};

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
