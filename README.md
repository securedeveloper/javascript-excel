# javascript-excel

> **2.0 is a from-scratch rewrite and is in progress.** Nothing on this branch is usable yet; the package currently ships only placeholder entry points.
>
> The last 1.x release is [`javascript-excel@1.0.3`](https://www.npmjs.com/package/javascript-excel/v/1.0.3) on npm. Keep using it until 2.0 is released.

## Goal

A TypeScript library, with no runtime dependencies, for reading and writing `.xlsx` and `.csv` files in browsers, Web Workers and Node. Each feature is documented here once it ships.

## Repository layout

| path | what |
|---|---|
| `packages/javascript-excel` | the published npm package |
| `apps/playground` | Vite playground (work in progress) |

## Development

Requires Node 22.18+ or 24.11+ for the toolchain (the published package targets Node 20+).

```sh
npm ci
npm run typecheck   # tsc, strict
npm test            # vitest
npm run build       # package (tsdown) + playground (vite)
npm run lint        # publint on the package
npm run smoke       # pack the tarball, install it, import/require every subpath
npm run dev -w apps/playground
```

## License

[MIT](LICENSE.md)
