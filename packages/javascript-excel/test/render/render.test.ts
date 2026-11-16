import { describe, expect, it } from "vitest";
import { resolveColor, toUint8Array, type CellInput, type Workbook } from "../../src/index";
import { read } from "../../src/read";
import {
  colAt,
  colLeft,
  colWidth,
  createRenderSheet,
  edge,
  isColHidden,
  isRowHidden,
  lastUsedCell,
  mergeAt,
  rangeAsHtml,
  rangeAsTsv,
  rangeStats,
  renderCell,
  rowAt,
  rowHeight,
  rowTop,
  sheetExtent,
  sheetSettings,
  step,
  type RenderFormatter,
} from "../../src/render";

const wb = (sheet: Workbook<CellInput>["sheets"][number], extra: Partial<Workbook<CellInput>> = {}): Workbook<CellInput> => ({ sheets: [sheet], ...extra });
const rs = (sheet: Workbook<CellInput>["sheets"][number], extra: Partial<Workbook<CellInput>> = {}, opts = {}) => createRenderSheet(wb(sheet, extra), 0, opts);

describe("geometry", () => {
  const s = rs({
    name: "S",
    rows: [[{ value: 1 }, { value: 2 }, { value: 3 }], [], [{ value: "x" }]],
    rowProps: [undefined, { hidden: true }, { height: 30 }],
    colProps: [{ width: 20 }, { width: 0 }, undefined],
  }, {}, { margin: { rows: 2, cols: 1 } });

  it("extent is the used range plus the margin", () => {
    expect(sheetExtent(s)).toEqual({ rows: 5, cols: 4 });
  });

  it("rows: points to px, defaults 15 pt = 20 px, hidden 0", () => {
    expect(rowHeight(s, 0)).toBe(20);
    expect(rowHeight(s, 1)).toBe(0);
    expect(isRowHidden(s, 1)).toBe(true);
    expect(rowHeight(s, 2)).toBe(40);
    expect(rowTop(s, 3)).toBe(60);
    expect(rowTop(s, 5)).toBe(100); // total height
  });

  it("columns: characters to px with the file-width formula, default 8.43 = 64 px", () => {
    expect(colWidth(s, 0)).toBe(145); // 20 characters at MDW 7
    expect(colWidth(s, 1)).toBe(0);
    expect(isColHidden(s, 1)).toBe(true);
    expect(colWidth(s, 2)).toBe(64);
    expect(colLeft(s, 3)).toBe(209);
  });

  it("hit testing skips hidden rows and columns and clamps", () => {
    expect(rowAt(s, 0)).toBe(0);
    expect(rowAt(s, 19.9)).toBe(0);
    expect(rowAt(s, 20)).toBe(2); // row 1 is hidden
    expect(rowAt(s, 1e9)).toBe(4);
    expect(rowAt(s, -5)).toBe(0);
    expect(colAt(s, 145)).toBe(2);
    expect(colAt(s, 144)).toBe(0);
  });

  it("takes defaults from the sheet and wpx widths", () => {
    const t = rs({ name: "S", rows: [[1]], defaultRowHeight: 12, defaultColWidth: 10, colProps: [undefined, { width: { wpx: 100 } }] });
    expect(rowHeight(t, 0)).toBe(16);
    expect(colWidth(t, 0)).toBe(75);
    expect(colWidth(t, 1)).toBe(100);
  });

  it("settings from the sheet view", () => {
    const t = rs({ name: "S", rows: [[1]], tabColor: "FF0000", view: { freeze: { rows: 1 }, rightToLeft: true, showGridLines: false, zoom: 85, activeCell: "B3", selection: "B3:C4" } });
    expect(sheetSettings(t)).toEqual({
      freeze: { rows: 1, cols: 0 }, rightToLeft: true, showGridLines: false, showHeaders: true, zoom: 85,
      activeCell: { row: 2, col: 1 }, selection: { start: { row: 2, col: 1 }, end: { row: 3, col: 2 } }, tabColor: "#FF0000",
    });
  });
});

describe("cells, styles and merges", () => {
  it("returns null for nothing to draw, and for covered merge cells", () => {
    const s = rs({ name: "S", rows: [[{ value: "Title" }, { value: "hidden by the merge" }]], merges: ["A1:C2"] });
    expect(mergeAt(s, 1, 2)).toEqual({ anchor: { row: 0, col: 0 }, range: { start: { row: 0, col: 0 }, end: { row: 1, col: 2 } } });
    expect(renderCell(s, 0, 0)).toMatchObject({ text: "Title", merge: { rows: 2, cols: 3 } });
    expect(renderCell(s, 0, 1)).toBeNull();
    expect(renderCell(s, 5, 5)).toBeNull();
    expect(renderCell(s, -1, 0)).toBeNull();
  });

  it("shares one RenderStyle per model style object (the reader's frozen styles)", async () => {
    const bold = { font: { bold: true, color: { theme: 4 } }, fill: "FFFF00" };
    const bytes = await toUint8Array(wb({ name: "S", rows: [[{ value: 1, style: bold }, { value: 2, style: bold }, { value: 3 }]] }));
    const { workbook } = await read(bytes, { dates: "serial" });
    const s = createRenderSheet(workbook, 0);
    const a = renderCell(s, 0, 0)!;
    const b = renderCell(s, 0, 1)!;
    expect(a.style).toBe(b.style);
    expect(Object.isFrozen(a.style)).toBe(true);
    expect(a.style.font).toMatchObject({ bold: true, color: "#4472C4", family: "Calibri", sizePt: 11 });
    expect(a.style.background).toEqual({ kind: "solid", color: "#FFFF00" });
    expect(renderCell(s, 0, 2)!.style.font.bold).toBe(false);
  });

  it("resolves fills, fonts, alignment and the row/column style fallback", () => {
    const s = rs(
      {
        name: "S",
        rows: [[
          { value: "a", style: { fill: { pattern: "lightGrid", fgColor: { indexed: 10 } }, font: { underline: true, italic: true, size: 14 }, alignment: { horizontal: "center", wrapText: true, rotation: 45, readingOrder: "rtl" } } },
          { value: "b", style: { fill: { type: "gradient", gradient: "linear", degree: 90, stops: [{ position: 0, color: "FF0000" }, { position: 1, color: { theme: 0 } }] } } },
        ], [undefined, undefined]],
        rowProps: [undefined, { style: { fill: "00FF00" } }],
      },
      { defaultFont: { name: "Arial", size: 10 } },
    );
    const a = renderCell(s, 0, 0)!;
    expect(a.style.background).toEqual({ kind: "pattern", pattern: "lightGrid", fg: "#FF0000", bg: "#FFFFFF" });
    expect(a.style.font).toMatchObject({ family: "Arial", sizePt: 14, italic: true, underline: "single" });
    expect(a.style.align).toMatchObject({ horizontal: "center", vertical: "bottom", wrap: true, rotation: 45, direction: "rtl" });
    expect(renderCell(s, 0, 1)!.style.background).toEqual({ kind: "gradient", gradient: "linear", degree: 90, stops: [{ position: 0, color: "#FF0000" }, { position: 1, color: "#FFFFFF" }] });
    // An empty cell in a styled row is drawn with the row style.
    expect(renderCell(s, 1, 0)).toMatchObject({ text: "", type: "empty", style: { background: { kind: "solid", color: "#00FF00" } } });
  });

  it("border edges: heavier wins, a tie goes to the lower/right cell, and empty cells draw a neighbour's edge", () => {
    const thin = { style: "thin" as const, color: "0000FF" };
    const thick = { style: "thick" as const, color: "FF0000" };
    const s = rs({
      name: "S",
      rows: [
        [{ value: 1, style: { border: { bottom: thick, right: thin } } }, { value: 2, style: { border: { left: { style: "thin", color: "00FF00" } } } }],
        [{ value: 3, style: { border: { top: thin } } }],
        [undefined, { value: 4, style: { border: { bottom: thin } } }],
      ],
    }, {}, { margin: { rows: 0, cols: 0 } });
    expect(renderCell(s, 1, 0)!.edges.top).toEqual({ style: "thick", color: "#FF0000" }); // thick above beats thin below
    expect(renderCell(s, 0, 1)!.edges.left).toEqual({ style: "thin", color: "#00FF00" }); // tie: the right cell wins
    expect(renderCell(s, 2, 1)!.edges.bottom).toEqual({ style: "thin", color: "#0000FF" }); // last row: the cell draws its own bottom edge
    // A cell with nothing of its own but a bordered neighbour above is drawn for its top edge.
    const t = rs({ name: "S", rows: [[{ value: 1, style: { border: { bottom: thick } } }], [undefined]] }, {}, { margin: { rows: 1, cols: 0 } });
    expect(renderCell(t, 1, 0)).toMatchObject({ text: "", edges: { top: { style: "thick" } } });
    expect(renderCell(t, 2, 0)).toBeNull();
  });

  it("covered merge cells lend the anchor's style to their neighbours' edges", () => {
    const s = rs({ name: "S", rows: [[{ value: "m", style: { border: { right: { style: "medium" } } } }]], merges: ["A1:B1"] });
    expect(renderCell(s, 0, 2)!.edges.left).toEqual({ style: "medium", color: "#000000" });
  });
});

describe("text, formulas and hyperlinks", () => {
  const s = rs(
    {
      name: "Data",
      rows: [
        [
          { value: 1234.5, style: { numFmt: "#,##0.00" } },
          { formula: '_xlfn.XLOOKUP(A1,"_xlfn.text",_xlfn._xlws.FILTER(B:B))', value: 3 },
          { formula: "NOW()" },
          { formula: "SUM(A1:A2)", arrayRef: "D1:D2", value: 7 },
        ],
        [
          { value: "go", hyperlink: "https://example.com/a" },
          { value: "bad", hyperlink: { target: "javascript:alert(1)", tooltip: "hi" } },
          { value: "rel", hyperlink: "/relative" },
          { value: "in", hyperlink: { location: "'Other sheet'!$B$4" } },
          { value: "name", hyperlink: { location: "Target" } },
          { value: "gone", hyperlink: { location: "Nowhere!A1" } },
        ],
        [{ value: { richText: [{ text: "a" }, { text: "B", font: { bold: true } }] } }, { value: true }, { value: { error: "#N/A" } }],
      ],
    },
    { definedNames: [{ name: "Target", ref: "Data!$C$9" }] },
  );
  // The extra sheet for internal links.
  const book: Workbook<CellInput> = { sheets: [{ name: "Data", rows: [] }, { name: "Other sheet", rows: [] }] };

  it("text is cellText without a format hook, and alignment follows the type", () => {
    expect(renderCell(s, 0, 0)).toMatchObject({ text: "1234.5", align: "right", type: "number" });
    expect(renderCell(s, 2, 1)).toMatchObject({ text: "TRUE", align: "center" });
    expect(renderCell(s, 2, 2)).toMatchObject({ text: "#N/A", align: "center" });
    expect(renderCell(s, 2, 0)!.runs).toEqual([
      { text: "a", font: expect.objectContaining({ bold: false }) },
      { text: "B", font: expect.objectContaining({ bold: true }) },
    ]);
  });

  it("uses the format hook, with ARGB colours as #RRGGBB", () => {
    const seen: unknown[] = [];
    const format: RenderFormatter = (cell, o) => {
      seen.push(o);
      return { text: `<${String(cell.value)}>`, color: "FFFF0000", align: "center", fill: { char: "-", at: 0 } };
    };
    const t = createRenderSheet(wb({ name: "S", rows: [[5]] }, { date1904: true }), 0, { format, locale: "de-DE" });
    expect(renderCell(t, 0, 0)).toMatchObject({ text: "<5>", color: "#FF0000", align: "center", fill: { char: "-", at: 0 } });
    expect(seen).toEqual([{ locale: "de-DE", date1904: true, indexedColors: undefined }]);
  });

  it("formula text: '=', prefixes removed outside strings, array flag, no cached value", () => {
    expect(renderCell(s, 0, 1)!.formula).toBe('=XLOOKUP(A1,"_xlfn.text",FILTER(B:B))');
    expect(renderCell(s, 0, 2)).toMatchObject({ formula: "=NOW()", noCachedValue: true, text: "" });
    expect(renderCell(s, 0, 3)).toMatchObject({ formula: "=SUM(A1:A2)", arrayFormula: true, text: "7" });
  });

  it("hyperlinks: scheme allowlist, malformed targets, internal locations", () => {
    expect(renderCell(s, 1, 0)!.hyperlink).toEqual({ kind: "external", href: "https://example.com/a", allowed: true });
    expect(renderCell(s, 1, 1)!.hyperlink).toEqual({ kind: "external", href: "javascript:alert(1)", allowed: false, reason: "scheme", tooltip: "hi" });
    expect(renderCell(s, 1, 2)!.hyperlink).toMatchObject({ allowed: false, reason: "malformed" });
    const t = createRenderSheet({ ...book, sheets: [{ ...book.sheets[0]!, rows: [[{ value: "in", hyperlink: { location: "'Other sheet'!$B$4" } }, { value: "n", hyperlink: { location: "Target" } }, { value: "g", hyperlink: { location: "Nowhere!A1" } }, { value: "x", hyperlink: { target: "ftp://x" } }]] }, book.sheets[1]!], definedNames: [{ name: "Target", ref: "'Other sheet'!$C$9" }] }, 0, { hyperlinkSchemes: ["FTP"] });
    expect(renderCell(t, 0, 0)!.hyperlink).toEqual({ kind: "internal", sheet: 1, ref: "B4" });
    expect(renderCell(t, 0, 1)!.hyperlink).toEqual({ kind: "internal", sheet: 1, ref: "C9" });
    expect(renderCell(t, 0, 2)!.hyperlink).toEqual({ kind: "internal", sheet: null, ref: "A1" });
    expect(renderCell(t, 0, 3)!.hyperlink).toMatchObject({ allowed: true });
  });
});

describe("navigation", () => {
  // Column A: 1, 2, 3, _, _, 6 ; row 4 hidden ; B1:C1 merged.
  const s = rs({
    name: "S",
    rows: [[1, "m"], [2], [3], [], [], [6]],
    rowProps: [undefined, undefined, undefined, { hidden: true }],
    merges: ["B1:C1"],
  }, {}, { margin: { rows: 3, cols: 2 } });

  it("step moves one visible cell, merge-aware, and stays at the edge", () => {
    expect(step(s, { row: 2, col: 0 }, "down")).toEqual({ row: 4, col: 0 }); // row 3 is hidden
    expect(step(s, { row: 0, col: 0 }, "right")).toEqual({ row: 0, col: 1 }); // lands on the merge anchor
    expect(step(s, { row: 0, col: 2 }, "right")).toEqual({ row: 0, col: 3 }); // leaves the merge from its right edge
    expect(step(s, { row: 0, col: 0 }, "up")).toEqual({ row: 0, col: 0 });
    expect(step(s, { row: 0, col: 0 }, "left")).toEqual({ row: 0, col: 0 });
  });

  it("edge follows Excel's data-region rule", () => {
    expect(edge(s, { row: 0, col: 0 }, "down")).toEqual({ row: 2, col: 0 }); // to the end of the block
    expect(edge(s, { row: 2, col: 0 }, "down")).toEqual({ row: 5, col: 0 }); // jumps the gap to the next value
    expect(edge(s, { row: 5, col: 0 }, "down")).toEqual({ row: 8, col: 0 }); // nothing below: the extent's edge
    expect(edge(s, { row: 5, col: 0 }, "up")).toEqual({ row: 2, col: 0 });
    expect(edge(s, { row: 0, col: 0 }, "right")).toEqual({ row: 0, col: 1 });
  });

  it("lastUsedCell is the used range's corner", () => {
    expect(lastUsedCell(s)).toEqual({ row: 5, col: 2 });
  });
});

describe("copy and summary", () => {
  const evil = '<img src=x onerror="alert(1)">';
  const s = rs({
    name: "S",
    rows: [
      [{ value: "a\tb" }, { value: 'say "hi"' }, { value: "x" }],
      [{ value: 1.5 }, { value: evil, style: { font: { name: 'Ev"il', bold: true }, border: { top: { style: "thick", color: "FF0000" } } } }, undefined],
      [{ value: new Date(2024, 0, 15) }, { value: "line\nbreak" }, { value: 2 }],
    ],
    merges: ["C1:C2"],
  });

  it("TSV: tabs, CRLF, quoting as Excel writes it, merges once", () => {
    expect(rangeAsTsv(s, { start: { row: 0, col: 0 }, end: { row: 1, col: 2 } })).toBe('"a\tb"\t"say ""hi"""\tx\r\n1.5\t' + '"<img src=x onerror=""alert(1)"">"' + "\t");
    expect(rangeAsTsv(s, { start: { row: 2, col: 1 }, end: { row: 2, col: 2 } })).toBe('"line\nbreak"\t2');
  });

  it("HTML: escaped text and styles, spans for merges inside the range", () => {
    const html = rangeAsHtml(s, { start: { row: 0, col: 0 }, end: { row: 1, col: 2 } });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain('rowspan="2"');
    expect(html).toContain("font-weight:bold");
    expect(html).toContain("border-top:3px solid #FF0000");
    expect(html).not.toMatch(/font-family:[^;]*Ev"il/);
    expect(html.match(/<td/g)!.length).toBe(5);
  });

  it("stats count non-empty cells and sum numbers and dates, up to a limit", () => {
    const all = { start: { row: 0, col: 0 }, end: { row: 2, col: 2 } };
    const st = rangeStats(s, all);
    expect(st).toMatchObject({ count: 8, numericCount: 3, truncated: false });
    expect(st.sum).toBeCloseTo(1.5 + 45306 + 2, 6);
    expect(rangeStats(s, all, 4)).toMatchObject({ truncated: true });
  });
});

describe("resolveColor", () => {
  it("theme colours use the swapped order and the file's theme", () => {
    expect(resolveColor({ theme: 0 })).toBe("FFFFFFFF");
    expect(resolveColor({ theme: 1 })).toBe("FF000000");
    expect(resolveColor({ theme: 4 })).toBe("FF4472C4");
    expect(resolveColor({ theme: 4 }, { theme: { colors: ["FF000000", "FFFFFFFF", "", "", "FF112233"] } })).toBe("FF112233");
  });

  it("applies tints on luminance", () => {
    expect(resolveColor({ theme: 0, tint: -0.5 })).toBe("FF808080");
    expect(resolveColor({ theme: 1, tint: 0.5 })).toBe("FF808080");
    expect(resolveColor({ theme: 4, tint: 0.7999816888943144 })).toBe("FFDAE3F3"); // Excel's "Blue, Accent 1, Lighter 80%"
  });

  it("indexed, rgb, string and automatic colours", () => {
    expect(resolveColor({ indexed: 10 })).toBe("FFFF0000");
    expect(resolveColor({ indexed: 64 })).toBe("FF000000");
    expect(resolveColor({ indexed: 10 }, { indexedColors: Array.from({ length: 64 }, (_, i) => (i === 10 ? "FF123456" : "FF000000")) })).toBe("FF123456");
    expect(resolveColor("#abcdef")).toBe("FFABCDEF");
    expect(resolveColor({ rgb: "80112233" })).toBe("80112233");
    expect(resolveColor({ auto: true })).toBe("FF000000");
    expect(resolveColor("nonsense")).toBe("FF000000");
  });
});
