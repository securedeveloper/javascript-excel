---
"javascript-excel": patch
---

The `exports` map now names the type declarations explicitly: each subpath has `import: { types: "./dist/x.d.ts", default: "./dist/x.js" }` and `require: { types: "./dist/x.d.cts", default: "./dist/x.cjs" }`. TypeScript already found the declarations next to the JavaScript files; the explicit `types` conditions don't depend on that lookup.
