# javascript-excel

> **2.0 is a from-scratch rewrite and is in progress.** The prerelease writes complete `.xlsx` files (cells, styles and sheet features), reads `.xlsx` files (`javascript-excel/read`), parses and serializes CSV (`javascript-excel/csv`), and turns HTML tables into sheets and downloads files (`javascript-excel/dom`). The Web Worker entry (`javascript-excel/worker`) is still to come: it is a placeholder in this prerelease. The API may change before 2.0.0.
>
> The last 1.x release is [`javascript-excel@1.0.3`](https://www.npmjs.com/package/javascript-excel/v/1.0.3) on npm. Keep using it until 2.0 is released.

## Goal

A TypeScript library, with no runtime dependencies, for reading and writing `.xlsx` and `.csv` files in browsers, Web Workers and Node 22+. Each feature is documented here once it ships.

## TypeScript

Types are tested with TypeScript 5.0–7. Your `tsconfig.json` must use `moduleResolution` `node16`, `nodenext` or `bundler`, so that TypeScript reads the package's `exports` map. CI type-checks the packed tarball with every TypeScript minor from 5.0 to 7.0 in all three modes.

## Repository layout

| path | what |
|---|---|
| `packages/javascript-excel` | the published npm package |
| `apps/playground` | Vite playground (work in progress) |

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
npm run dev -w apps/playground
```

## Performance

Measured by `npm run bench` (`packages/javascript-excel/bench/run.mjs`) in the non-required `Benchmarks` CI job on **GitHub Actions `ubuntu-latest` (Ubuntu 26, x64, AMD EPYC 7763, 4 vCPUs, 16 GB), Node 24.22.2**, on 2026-11-16. Sheets are 10 columns wide. Times are medians of 5 runs (3 at 1M cells). The peak heap is the growth during the operation, and the longest block is the longest time the event loop could not run a 1 ms timer.

| operation | sheet | 10k cells | 100k cells | 1M cells | 1M: peak heap | 1M: longest block | 1M: file |
|---|---|---:|---:|---:|---:|---:|---:|
| xlsx write (`toUint8Array`) | numbers | 19 ms | 124 ms | 1,055 ms | 43 MB | 22 ms | 3.2 MB |
| xlsx write (`toUint8Array`) | repeated strings | 15 ms | 80 ms | 652 ms | 29 MB | 23 ms | 2.6 MB |
| xlsx write (`toUint8Array`) | unique strings | 30 ms | 225 ms | 2,301 ms | 233 MB | 29 ms | 5.5 MB |
| xlsx write (`toUint8Array`) | styled numbers | 21 ms | 128 ms | 1,189 ms | 54 MB | 21 ms | 4.5 MB |
| xlsx read (`read`) | numbers | 42 ms | 156 ms | 1,249 ms | 152 MB | 23 ms | 3.2 MB |
| xlsx read (`read`) | repeated strings | 39 ms | 163 ms | 1,280 ms | 143 MB | 6 ms | 2.6 MB |
| xlsx read (`read`) | unique strings | 50 ms | 243 ms | 2,011 ms | 195 MB | 16 ms | 5.5 MB |
| xlsx read (`read`) | styled numbers | 42 ms | 190 ms | 1,541 ms | 164 MB | 9 ms | 4.5 MB |
| CSV write (`toCsv`) | numbers | 2 ms | 17 ms | 136 ms | 50 MB | 150 ms | 8 MB |
| CSV write (`toCsv`) | repeated strings | 1 ms | 11 ms | 76 ms | 23 MB | 85 ms | 8.6 MB |
| CSV write (`toCsv`) | unique strings | 1 ms | 11 ms | 86 ms | 54 MB | 99 ms | 12.4 MB |
| CSV read (`readCsv`) | numbers | 1 ms | 16 ms | 97 ms | 73 MB | 19 ms | 8 MB |
| CSV read (`readCsv`) | repeated strings | 3 ms | 17 ms | 111 ms | 66 MB | 23 ms | 8.6 MB |
| CSV read (`readCsv`) | unique strings | 2 ms | 19 ms | 127 ms | 71 MB | 22 ms | 12.4 MB |

- **numbers**: `k * 1.5`. **repeated strings**: 100 distinct labels. **unique strings**: a different string in every cell, so the shared strings table is as large as the sheet. **styled numbers**: 8 rotating styles with font, fill, border and number format.
- The xlsx writer and reader never block the event loop for long (21–29 ms at 1M cells), because every chunk goes through the platform's compression stream. `toCsv` is synchronous by design and blocks for its whole run. For big jobs where the UI must stay smooth, use `javascript-excel/worker`.
- Numbers from other machines differ. Rerun with `npm run build && npm run bench` (add `-- --sizes 10000,100000` for a quick run).

## Releasing

Versions are managed with [Changesets](https://github.com/changesets/changesets). Merging a pull request that bumps the version publishes it to npm. See [RELEASING.md](RELEASING.md).

## License

[MIT](LICENSE.md)
