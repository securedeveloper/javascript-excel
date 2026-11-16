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

## Releasing

Versions are managed with [Changesets](https://github.com/changesets/changesets). Merging a pull request that bumps the version publishes it to npm. See [RELEASING.md](RELEASING.md).

## License

[MIT](LICENSE.md)
