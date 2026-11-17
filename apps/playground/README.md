# javascript-excel playground (dev sandbox)

> **Dev sandbox, not deployed.** This app runs in CI (tests and build) and locally. It is not deployed anywhere. The public playground is a separate repository, [`securedeveloper/javascript-excel-playground`](https://github.com/securedeveloper/javascript-excel-playground), live at https://javascript-excel-playground.vercel.app/. It installs the published package from npm.

A small Vite + vanilla TypeScript app that runs the real library in the browser. It is private and never published to npm.

- **Write**: edit a dataset (JSON), pick options (freeze, autofilter, auto width, totals, banded rows, header fill), preview the sheet, then download `.xlsx` (`fromDataset` + `toBlob`) or `.csv` (`toCsvBlob`).
- **Read**: choose or drop an `.xlsx`/`.xlsm`/`.xltx`/`.xltm` or `.csv`/`.tsv` file to see its sheets, a cell table with basic resolved styles (bold, italics, colours, fills, alignment; number format and formula in the cell tooltip), and the warnings. Files of 1 MiB or more are read in a Web Worker (`javascript-excel/worker`); a checkbox forces the worker for any size. Reads can be cancelled.
- **Table**: a static HTML table goes through `fromTable` (merges, `data-*` hints, ignored and hidden rows, links, computed styles), then downloads as `.xlsx` or `.csv`.

The app imports the workspace package's TypeScript sources (see `vite.config.ts`), so it always matches the branch. Files never leave the browser: there are no uploads, analytics, cookies or external requests. `vite.config.ts` gives `vite preview` a strict Content-Security-Policy (`'self'` only) and the other security headers, so the CSP gets tested locally.

## Commands (from the repo root)

```sh
npm ci
npm -w apps/playground run dev        # http://localhost:5173
npm -w apps/playground run test       # renderer unit tests (happy-dom)
npm -w apps/playground run build      # → apps/playground/dist
npm -w apps/playground run preview    # serves dist with the security headers
```
