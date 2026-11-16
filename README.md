# javascript-excel

> **2.0 is a from-scratch rewrite and is in progress.** The prerelease builds sheets from `{ columns, data }` datasets (`fromDataset`, `fromDatasets`, and `toDataset` for the way back), writes complete `.xlsx` files (cells, styles and sheet features), reads `.xlsx` files (`javascript-excel/read`), parses and serializes CSV (`javascript-excel/csv`), turns HTML tables into sheets and downloads files (`javascript-excel/dom`), runs big jobs in a Web Worker (`javascript-excel/worker`), and imports users' `.xlsx`/`.csv` files as datasets (`javascript-excel/import`). The API may change before 2.0.0.
>
> The last 1.x release is [`javascript-excel@1.0.3`](https://www.npmjs.com/package/javascript-excel/v/1.0.3) on npm. Keep using it until 2.0 is released.

## Goal

A TypeScript library, with no runtime dependencies, for reading and writing `.xlsx` and `.csv` files in browsers, Web Workers and Node 22+.

**Using it:** start with the [package README](packages/javascript-excel/README.md), which covers install, quick starts and what ships, and the [guides](docs/guides/README.md), which have runnable Node, vanilla, React and Vue 3 examples. The design and full API are in [docs/api.md](docs/api.md). An API reference generated from the type declarations is built in CI (artifact `api-reference`, or `npm run docs:api` locally).

## TypeScript

Types are tested with TypeScript 5.0–7. Your `tsconfig.json` must use `moduleResolution` `node16`, `nodenext` or `bundler`, so that TypeScript reads the package's `exports` map. CI type-checks the packed tarball with every TypeScript minor from 5.0 to 7.0 in all three modes.

## Repository layout

| path | what |
|---|---|
| `packages/javascript-excel` | the published npm package |
| `apps/playground` | Vite playground (work in progress) |
| `examples/` | runnable examples used by the guides (Node, vanilla, React, Vue 3) and the README snippets; checked in CI |
| `docs/` | `api.md` (design and API) and `guides/` |
| `tools/api-docs` | API reference generator (TypeDoc) |

## Development

The published package supports Node 22 and later. Working on this repository needs Node 22.18+ or 24.11+ (the build tools require it); CI runs on Node 22 and 24.

```sh
npm ci
npm run typecheck   # tsc, strict
npm test            # vitest
npm run build       # package (tsdown) + playground (vite)
npm run lint        # publint on the package
npm run smoke       # pack the tarball, install it, import/require every subpath
npm run consumer-ts # type-check the packed tarball with TypeScript 5.0–7.0
npm run examples    # build the package, check and build every example, run the Node one
npm run docs:check  # the code in the READMEs and guides matches examples/
npm run docs:api    # API reference from the .d.ts into tools/api-docs/out
npm run dev -w apps/playground
```

## Performance

Measured by `npm run bench` (`packages/javascript-excel/bench/run.mjs`) in the non-required `Benchmarks` CI job on **GitHub Actions `ubuntu-latest` (Ubuntu 26, x64, AMD EPYC 7763, 4 vCPUs, 16 GB), Node 24.22.2**, on 2026-11-16. Sheets are 10 columns wide. Times are medians of 5 runs (3 at 1M cells). The peak heap is the growth during the operation, and the longest block is the longest time the event loop could not run a 1 ms timer.

| operation | sheet | 10k cells | 100k cells | 1M cells | 1M: peak heap | 1M: longest block | 1M: file |
|---|---|---:|---:|---:|---:|---:|---:|
| xlsx write (`toUint8Array`) | numbers | 20 ms | 121 ms | 1,303 ms | 42 MB | 22 ms | 3.2 MB |
| xlsx write (`toUint8Array`) | repeated strings | 15 ms | 81 ms | 662 ms | 29 MB | 23 ms | 2.6 MB |
| xlsx write (`toUint8Array`) | unique strings | 30 ms | 225 ms | 2,459 ms | 230 MB | 23 ms | 5.5 MB |
| xlsx write (`toUint8Array`) | styled, shared style objects | 22 ms | 133 ms | 1,200 ms | 52 MB | 23 ms | 4.5 MB |
| xlsx write (`toUint8Array`) | styled, a new style object per cell | 39 ms | 260 ms | 2,482 ms | 58 MB | 28 ms | 4 MB |
| xlsx read (`read`) | numbers | 29 ms | 158 ms | 1,250 ms | 153 MB | 10 ms | 3.2 MB |
| xlsx read (`read`) | repeated strings | 41 ms | 167 ms | 1,289 ms | 143 MB | 7 ms | 2.6 MB |
| xlsx read (`read`) | unique strings | 53 ms | 246 ms | 2,026 ms | 195 MB | 18 ms | 5.5 MB |
| xlsx read (`read`) | styled, shared style objects | 45 ms | 196 ms | 1,579 ms | 160 MB | 9 ms | 4.5 MB |
| xlsx read (`read`) | styled, a new style object per cell | 35 ms | 213 ms | 1,564 ms | 164 MB | 10 ms | 4 MB |
| CSV write (`toCsv`) | numbers | 2 ms | 16 ms | 134 ms | 49 MB | 151 ms | 8 MB |
| CSV write (`toCsv`) | repeated strings | 1 ms | 11 ms | 78 ms | 23 MB | 86 ms | 8.6 MB |
| CSV write (`toCsv`) | unique strings | 1 ms | 10 ms | 86 ms | 54 MB | 98 ms | 12.4 MB |
| CSV read (`readCsv`) | numbers | 4 ms | 17 ms | 99 ms | 73 MB | 20 ms | 8 MB |
| CSV read (`readCsv`) | repeated strings | 2 ms | 16 ms | 110 ms | 66 MB | 22 ms | 8.6 MB |
| CSV read (`readCsv`) | unique strings | 2 ms | 20 ms | 120 ms | 71 MB | 23 ms | 12.4 MB |

- **numbers**: `k * 1.5`. **repeated strings**: 100 distinct labels. **unique strings**: a different string in every cell, so the shared strings table is as large as the sheet. **styled**: 8 styles with font, colour and number format, given either as 8 shared objects or as a new object literal per cell (how most app code writes them).
- The xlsx writer and reader never block the event loop for long (22–28 ms when writing and 7–18 ms when reading 1M cells), because every chunk goes through the platform's compression stream. `toCsv` is synchronous by design and blocks for its whole run. For big jobs where the UI must stay smooth, use `javascript-excel/worker`.
- Numbers from other machines differ. Rerun with `npm run build && npm run bench` (add `-- --sizes 10000,100000` for a quick run).

## Releasing

Versions are managed with [Changesets](https://github.com/changesets/changesets). Merging a pull request that bumps the version publishes it to npm. See [RELEASING.md](RELEASING.md).

## License

[MIT](LICENSE.md)
