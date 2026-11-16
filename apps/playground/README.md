# javascript-excel playground

A small Vite + vanilla TypeScript app that runs the real library in the browser. It is private and never published to npm.

- **Write**: edit a dataset (JSON), pick options (freeze, autofilter, auto width, totals, banded rows, header fill), preview the sheet, then download `.xlsx` (`fromDataset` + `toBlob`) or `.csv` (`toCsvBlob`).
- **Read**: choose or drop an `.xlsx`/`.xlsm`/`.xltx`/`.xltm` or `.csv`/`.tsv` file to see its sheets, a cell table with basic resolved styles (bold, italics, colours, fills, alignment; number format and formula in the cell tooltip), and the warnings. Files of 1 MiB or more are read in a Web Worker (`javascript-excel/worker`); a checkbox forces the worker for any size. Reads can be cancelled.
- **Table**: a static HTML table goes through `fromTable` (merges, `data-*` hints, ignored and hidden rows, links, computed styles), then downloads as `.xlsx` or `.csv`.

The app imports the workspace package's TypeScript sources (see `vite.config.ts`), so it always matches the branch. Files never leave the browser: there are no uploads, analytics, cookies or external requests. `vercel.json` sets a strict Content-Security-Policy (`'self'` only), and `vite preview` serves the same headers, so the CSP gets tested locally.

## Commands (from the repo root)

```sh
npm ci
npm -w apps/playground run dev        # http://localhost:5173
npm -w apps/playground run test       # renderer unit tests (happy-dom)
npm -w apps/playground run build      # → apps/playground/dist
npm -w apps/playground run preview    # serves dist with the production headers
```

## Deploying on Vercel

| Setting | Value |
|---|---|
| Root Directory | `apps/playground` |
| Framework preset | Vite (also set in `vercel.json`) |
| Install command | `cd ../.. && npm ci` (from `vercel.json`: installs the whole workspace) |
| Build command | `npm run build` (from `vercel.json`) |
| Output directory | `dist` (from `vercel.json`) |
| Node.js version | 24.x (the workspace needs Node ^22.18, ^24.11 or ≥ 26) |

"Include files outside the root directory in the Build Step" must stay enabled (Vercel's default), because the app builds the package from `../../packages/javascript-excel/src`.
