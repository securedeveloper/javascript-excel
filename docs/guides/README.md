# Guides

Each guide walks through a complete, runnable example from [`examples/`](../../examples). CI type-checks every example against the built package, builds the browser ones with Vite and runs the Node one, so the code shown here always works. `scripts/check-doc-snippets.mjs` keeps the code blocks identical to the example files.

| Guide | Example | Shows |
|---|---|---|
| [Node](node.md) | [`examples/node`](../../examples/node) | write `.xlsx` and `.csv` to disk, read both back |
| [Vanilla browser](vanilla.md) | [`examples/vanilla`](../../examples/vanilla) | export an HTML table, open a file, write in a Web Worker |
| [React](react.md) | [`examples/react`](../../examples/react) | export from an event handler, no hooks |
| [Vue 3](vue.md) | [`examples/vue`](../../examples/vue) | export a dataset and open a file with the Composition API |

The full API is in the generated reference (CI artifact `api-reference`, built with `npm run docs:api`) and in the design document [`docs/api.md`](../api.md).
