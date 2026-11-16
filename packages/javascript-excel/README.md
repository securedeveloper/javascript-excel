# javascript-excel

> **2.0 is a from-scratch rewrite and is in progress.** The prerelease writes complete `.xlsx` files (cells, styles and sheet features), and `javascript-excel/csv` parses and serializes CSV. The xlsx reader and the DOM helpers are still to come, and the API may change before 2.0.0.
>
> The last 1.x release is `javascript-excel@1.0.3`. Keep using it until 2.0 is released.

```ts
import { toUint8Array } from "javascript-excel";

const bytes = await toUint8Array({
  sheets: [
    {
      name: "Report",
      rows: [
        [{ value: "Item", style: { font: { bold: true }, fill: "DDEBF7" } }, "Qty", "Price"],
        ["Pens", 10, { value: 1.5, style: { numFmt: "#,##0.00" } }],
        ["Total", { formula: "SUM(B2:B2)", value: 10 }, new Date()],
      ],
    },
  ],
});
```

`toBlob()` returns the same file as a `Blob` for browser downloads.

**Written today:** strings (shared or inline), numbers, booleans, dates (1900 and 1904 systems), error values, rich text, formulas with cached values, array formulas, styled empty cells. The full style model: fonts, all fill patterns and gradients, all border styles with a colour per side, alignment (rotation, indent, reading order), protection flags, and built-in and custom number formats. Styles are deduplicated. Sheet order, names, visibility, the active sheet, the default font and document properties are written too.

**Sheet features:** column widths (characters, pixels or `'auto'`) and column styles, row heights and row styles, hidden rows and columns, outline levels, merges, autofilter, freeze panes, right-to-left sheets, zoom and selection, tab colours, default sizes, hyperlinks (external URLs limited to `http`, `https` and `mailto` unless you allow more with `hyperlinkSchemes`; internal locations), defined names, and print setup (orientation, paper size, fit to page, scale, margins, print area and titles, headers and footers).

Every writable field of the model is written; nothing is dropped silently. (`theme`, `indexedColors` and `dimension` are filled in by the reader and ignored on write.) Input that cannot be written faithfully throws a typed `ValidationError`.

Runs on Node.js 22+ and in browsers with `CompressionStream('deflate-raw')`. Types are tested with TypeScript 5.0–7, with `moduleResolution` set to `node16`, `nodenext` or `bundler`.

Source, status and issues: https://github.com/securedeveloper/javascript-excel

## License

MIT
