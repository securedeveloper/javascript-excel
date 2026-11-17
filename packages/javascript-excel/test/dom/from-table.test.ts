// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fromTable, type FromTableOptions } from "../../src/dom";
import { isExcelError, type Cell, type CellInput, type ExcelWarning } from "../../src/index";
import { cssColor } from "../../src/internal/css-color";

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

function table(html: string, css = ""): HTMLTableElement {
  if (css) document.head.innerHTML = `<style>${css}</style>`;
  document.body.innerHTML = html;
  return document.querySelector("table")!;
}
const read = (html: string, opts?: FromTableOptions, css?: string): ReturnType<typeof fromTable> => fromTable(table(html, css), opts);
const valueOf = (c: CellInput): unknown => (c !== null && typeof c === "object" && !(c instanceof Date) && !("error" in c) && !("richText" in c) ? (c as Cell).value : c);
const values = (rows: ReadonlyArray<ReadonlyArray<CellInput> | undefined>): unknown[][] => rows.map((r) => Array.from(r ?? [], (c) => valueOf(c)));

describe("fromTable: structure", () => {
  it("reads thead, then tbody and bare rows, then tfoot, in that order", () => {
    const s = read(`<table>
      <tfoot><tr><td>foot</td></tr></tfoot>
      <tbody><tr><td>b1</td></tr></tbody>
      <thead><tr><th>head</th></tr></thead>
      <tbody><tr><td>b2</td></tr></tbody>
    </table>`);
    expect(values(s.rows)).toEqual([["head"], ["b1"], ["b2"], ["foot"]]);
    expect(s.name).toBe("Sheet1");
  });

  it("includeFooter: false drops tfoot", () => {
    expect(values(read("<table><tbody><tr><td>a</td></tr></tbody><tfoot><tr><td>f</td></tr></tfoot></table>", { includeFooter: false }).rows)).toEqual([["a"]]);
  });

  it("colspan and rowspan become merges on an occupancy grid", () => {
    const s = read(`<table>
      <tr><td rowspan="2">A</td><td colspan="2">B</td><td>C</td></tr>
      <tr><td>D</td><td rowspan="2" colspan="2">E</td></tr>
      <tr><td>F</td><td>G</td></tr>
    </table>`);
    expect(values(s.rows)).toEqual([
      ["A", "B", undefined, "C"],
      [undefined, "D", "E"],
      ["F", "G"],
    ]);
    expect(s.merges).toEqual(["A1:A2", "B1:C1", "C2:D3"]);
  });

  it("rowspan=0 spans to the end of its row group; spans are clamped to the table", () => {
    const s = read(`<table><tbody><tr><td rowspan="0">x</td><td>1</td></tr><tr><td>2</td></tr></tbody><tbody><tr><td rowspan="9">y</td></tr></tbody></table>`);
    expect(s.merges).toEqual(["A1:A2"]);
    expect(values(s.rows)).toEqual([["x", "1"], [undefined, "2"], ["y"]]);
  });

  it("nested tables are text of their cell, not rows", () => {
    const s = read(`<table><tr><td>outer <table><tr><td>inner</td></tr></table></td></tr></table>`);
    expect(values(s.rows)).toEqual([["outer inner"]]);
  });

  it("throws for a non-table element, an invalid sheet name, and outside a DOM", () => {
    document.body.innerHTML = "<div></div>";
    expect(() => fromTable(document.querySelector("div") as unknown as HTMLTableElement)).toThrow(TypeError);
    const err = (() => {
      try {
        read("<table><tr><td>a</td></tr></table>", { name: "a/b" });
      } catch (e) {
        return e;
      }
    })();
    expect(isExcelError(err) && err.code).toBe("INVALID_SHEET_NAME");
    let env: unknown;
    try {
      fromTable({} as HTMLTableElement);
    } catch (e) {
      env = e;
    }
    expect(isExcelError(env) && env.code).toBe("ENVIRONMENT_UNSUPPORTED");
  });
});

describe("fromTable: text and values", () => {
  it("collapses whitespace, turns <br> into a newline with wrapText, ignores script/style", () => {
    const s = read(`<table><tr><td>  a \n  b  </td><td>line 1<br>  line 2 </td><td>x<script>evil()</script><style>.z{}</style></td><td>&nbsp;</td></tr></table>`);
    const [a, b, c, d] = s.rows[0]!;
    expect(a).toBe("a b");
    expect(b).toEqual({ value: "line 1\nline 2", style: { alignment: { wrapText: true } } });
    expect(c).toBe("x");
    expect(d).toBe("");
  });

  it("data-value, data-type and data-numfmt hints", () => {
    const s = read(`<table><tr>
      <td data-type="number" data-value="1234.5">1.234,50 €</td>
      <td data-type="number">1,234,567.89</td>
      <td data-type="boolean">Yes</td>
      <td data-type="date">2024-01-15</td>
      <td data-type="date" data-value="2024-01-15T10:30:00Z">15 Jan</td>
      <td data-numfmt="0.00%" data-type="number">0.256</td>
      <td data-numfmt="14" data-type="date">2024-02-29</td>
      <td data-type="string">007</td>
    </tr></table>`);
    const r = s.rows[0]!;
    expect(r.slice(0, 3)).toEqual([1234.5, 1234567.89, true]);
    expect(r[3]).toEqual(new Date(2024, 0, 15));
    expect(r[4]).toEqual(new Date(Date.UTC(2024, 0, 15, 10, 30)));
    expect(r[5]).toEqual({ value: 0.256, style: { numFmt: "0.00%" } });
    expect(r[6]).toEqual({ value: new Date(2024, 1, 29), style: { numFmt: 14 } });
    expect(r[7]).toBe("007");
  });

  it("values that do not fit their data-type stay text, with COERCION_FAILED", () => {
    const warnings: ExcelWarning[] = [];
    const s = read(`<table><tr><td data-type="number">n/a</td><td data-type="date">2024-02-30</td><td data-type="boolean">maybe</td><td data-type="money">5</td></tr></table>`, {
      onWarning: (w) => warnings.push(w),
    });
    expect(s.rows[0]).toEqual(["n/a", "2024-02-30", "maybe", "5"]);
    expect(warnings.map((w) => [w.code, w.ref])).toEqual([["COERCION_FAILED", "A1"], ["COERCION_FAILED", "B1"], ["COERCION_FAILED", "C1"], ["COERCION_FAILED", "D1"]]);
  });

  it("inferTypes turns plain numbers and TRUE/FALSE into values, nothing else", () => {
    const s = read(`<table><tr><td>42</td><td>-3.5e2</td><td>true</td><td>1,234</td><td>007x</td><td>2024-01-15</td></tr></table>`, { inferTypes: true });
    expect(s.rows[0]).toEqual([42, -350, true, "1,234", "007x", "2024-01-15"]);
    expect(read(`<table><tr><td>42</td></tr></table>`).rows[0]).toEqual(["42"]);
  });

  it("the cell hook overrides the default mapping", () => {
    const s = read(`<table><thead><tr><th>h</th></tr></thead><tr><td data-id="7">x</td><td>y</td></tr></table>`, {
      cell: (el, ctx) => ((el as HTMLElement).dataset["id"] ? { value: Number((el as HTMLElement).dataset["id"]), style: { font: { italic: true } } } : ctx.header ? "H!" : undefined),
    });
    expect(s.rows).toEqual([["H!"], [{ value: 7, style: { font: { italic: true } } }, "y"]]);
  });
});

describe("fromTable: skipping", () => {
  it("skips hidden and data-export-ignore rows and cells; cells shift left", () => {
    const s = read(`<table>
      <tr><td>a</td><td hidden>h</td><td>b</td></tr>
      <tr hidden><td>gone</td></tr>
      <tr style="color: red; display: none"><td>gone too</td></tr>
      <tr data-export-ignore><td>ignored</td></tr>
      <tr><td data-export-ignore>x</td><td>c</td></tr>
    </table>`);
    expect(values(s.rows)).toEqual([["a", "b"], ["c"]]);
  });

  it("skipHidden: false keeps hidden rows; a custom ignore selector", () => {
    const s = read(`<table><tr hidden><td>h</td></tr><tr class="skip"><td>s</td></tr><tr data-export-ignore><td>i</td></tr></table>`, { skipHidden: false, ignore: ".skip" });
    expect(values(s.rows)).toEqual([["h"], ["i"]]);
  });

  it("with computed styles, CSS display:none also skips", () => {
    const s = read(`<table><tr class="x"><td>gone</td></tr><tr><td>kept</td></tr></table>`, { styles: "computed" }, ".x { display: none }");
    expect(values(s.rows)).toEqual([["kept"]]);
  });
});

describe("fromTable: header, freeze, filter, widths, RTL", () => {
  const html = `<table><thead><tr><th colspan="2">Group</th></tr><tr><th>Name</th><th>Qty</th></tr></thead><tbody><tr><td>Pens</td><td>10</td></tr><tr><td>A much longer name</td><td>2</td></tr></tbody></table>`;

  it("thead rows get headerStyle (bold by default), and freeze/filter use them", () => {
    const s = read(html, { freezeHeader: true, autoFilter: true });
    expect(s.rows[0]![0]).toEqual({ value: "Group", style: { font: { bold: true } } });
    expect(s.rows[1]![1]).toEqual({ value: "Qty", style: { font: { bold: true } } });
    expect(s.rows[2]![0]).toBe("Pens");
    expect(s.view).toEqual({ freeze: { rows: 2 } });
    expect(s.autoFilter).toBe("A2:B4");
    expect(s.merges).toEqual(["A1:B1"]);
  });

  it("header: a number of rows, or false; a custom headerStyle", () => {
    const s = read(html, { header: 1, headerStyle: { fill: "DDEBF7" } });
    expect(s.rows[0]![0]).toEqual({ value: "Group", style: { fill: "DDEBF7" } });
    expect(s.rows[1]![0]).toBe("Name");
    const none = read(html, { header: false, freezeHeader: true, autoFilter: true });
    expect(none.rows[0]![0]).toBe("Group");
    expect(none.view).toBeUndefined();
    expect(none.autoFilter).toBeUndefined();
  });

  it("autoWidth estimates widths from the text, within bounds", () => {
    expect(read(html, { autoWidth: true }).colProps).toEqual([{ width: 20 }, { width: 8.43 }]);
    expect(read(html, { autoWidth: { min: 3, max: 10 } }).colProps).toEqual([{ width: 10 }, { width: 5 }]);
  });

  it("dir=rtl on the table or an ancestor sets rightToLeft", () => {
    expect(read(`<table dir="rtl"><tr><td>a</td></tr></table>`).view).toEqual({ rightToLeft: true });
    document.body.innerHTML = `<div dir="rtl"><table><tr><td>a</td></tr></table></div>`;
    expect(fromTable(document.querySelector("table")!).view).toEqual({ rightToLeft: true });
  });
});

describe("fromTable: links", () => {
  it("the first <a href> becomes the hyperlink, resolved to an absolute URL", () => {
    const s = read(`<table><tr><td><a href="https://example.com/a">site</a></td><td><a href="mailto:x@example.com">mail</a></td><td><a href="/rel?q=1">rel</a></td><td><a href="#top">anchor</a></td></tr></table>`);
    const r = s.rows[0]! as Cell[];
    expect(r[0]).toEqual({ value: "site", hyperlink: "https://example.com/a" });
    expect(r[1]).toEqual({ value: "mail", hyperlink: "mailto:x@example.com" });
    expect(r[2]).toEqual({ value: "rel", hyperlink: `${location.origin}/rel?q=1` });
    expect(r[3]).toBe("anchor");
  });

  it("drops links with other schemes, with HYPERLINK_DROPPED; links: false keeps text only", () => {
    const warnings: ExcelWarning[] = [];
    const s = read(`<table><tr><td><a href="javascript:alert(1)">x</a></td><td><a href="ftp://f.example/x">ftp</a></td></tr></table>`, { onWarning: (w) => warnings.push(w) });
    expect(s.rows[0]).toEqual(["x", "ftp"]);
    expect(warnings.map((w) => w.code)).toEqual(["HYPERLINK_DROPPED", "HYPERLINK_DROPPED"]);
    expect(read(`<table><tr><td><a href="ftp://f.example/x">ftp</a></td></tr></table>`, { hyperlinkSchemes: ["ftp"] }).rows[0]).toEqual([{ value: "ftp", hyperlink: "ftp://f.example/x" }]);
    expect(read(`<table><tr><td><a href="https://x.example">x</a></td></tr></table>`, { links: false }).rows[0]).toEqual(["x"]);
  });
});

describe("fromTable: computed styles", () => {
  const cssText = `
    .bold { font-weight: 700 } .heavy { font-weight: bolder } .it { font-style: italic }
    .u { text-decoration: underline } .s { text-decoration: line-through }
    .red { color: rgb(192, 0, 0) } tr.band { background-color: #ddebf7 } .clear { background-color: rgba(0, 0, 0, 0) }
    .c { text-align: center } .r { text-align: right } .top { vertical-align: top } .mid { vertical-align: middle }
    .pre { white-space: pre-wrap }`;

  it("maps weight, style, decoration, colour, background (from the row), alignment and white-space", () => {
    const s = read(
      `<table><tr class="band"><td class="bold it">a</td><td class="u red">b</td><td class="s c top">c</td><td class="r mid pre clear">d</td><td class="heavy">e</td></tr><tr><td>plain</td></tr></table>`,
      { styles: "computed" },
      cssText,
    );
    const r = s.rows[0]! as Cell[];
    expect(r[0]!.style).toEqual({ font: { bold: true, italic: true }, fill: "DDEBF7" });
    expect(r[1]!.style).toEqual({ font: { underline: true, color: "C00000" }, fill: "DDEBF7" });
    expect(r[2]!.style).toEqual({ font: { strike: true }, fill: "DDEBF7", alignment: { horizontal: "center", vertical: "top" } });
    // A transparent cell background shows the row's colour.
    // vertical-align: middle is the HTML table default and is not mapped.
    expect(r[3]!.style).toEqual({ fill: "DDEBF7", alignment: { horizontal: "right", wrapText: true } });
    expect(r[4]!.style).toEqual({ font: { bold: true }, fill: "DDEBF7" });
    expect(s.rows[1]).toEqual(["plain"]);
  });

  it("header style and computed style merge; computed wins field by field", () => {
    const s = read(`<table><thead><tr><th class="it">h</th></tr></thead></table>`, { styles: "computed", headerStyle: { font: { bold: true, size: 14 } } }, ".it { font-style: italic }");
    expect(s.rows[0]![0]).toEqual({ value: "h", style: { font: { bold: true, size: 14, italic: true } } });
  });

  it("maps text and background colours given in CSS Color 4 spaces", () => {
    // happy-dom's CSS parser drops lab()/oklch()/color(), so the computed values Chromium
    // reports are served from data attributes here; test/browser covers real Chromium.
    const real = window.getComputedStyle.bind(window);
    const spy = vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
      const cs = real(el, pseudo);
      const over: Record<string, string | null> = { color: el.getAttribute("data-color"), "background-color": el.getAttribute("data-bg") };
      return new Proxy(cs, {
        get: (t, k) => (k === "getPropertyValue" ? (prop: string) => over[prop] ?? t.getPropertyValue(prop) : Reflect.get(t, k, t)),
      });
    });
    try {
      const s = read(
        `<table><tr data-bg="oklch(0.967 0.003 264.542)">
          <td data-color="oklch(62.8% 0.2577 29.23)">a</td>
          <td data-bg="lab(54.29% 80.8 69.89)">b</td>
          <td data-color="color(display-p3 1 0 0)" data-bg="lch(100% 0 0)">c</td>
          <td data-bg="oklab(0.628 0.2249 0.1258 / 0)">d</td>
          <td data-color="color(srgb 0 0 0)">e</td>
        </tr></table>`,
        { styles: "computed" },
      );
      const r = s.rows[0]! as Cell[];
      expect(r[0]!.style).toEqual({ font: { color: "FF0000" }, fill: "F3F4F6" });
      expect(r[1]!.style).toEqual({ fill: "FF0000" });
      expect(r[2]!.style).toEqual({ font: { color: "FF0000" }, fill: "FFFFFF" });
      // A transparent modern colour shows the row's background; black stays automatic.
      expect(r[3]!.style).toEqual({ fill: "F3F4F6" });
      expect(r[4]!.style).toEqual({ fill: "F3F4F6" });
    } finally {
      spy.mockRestore();
    }
  });

  it("styles: 'none' (default) maps nothing", () => {
    expect(read(`<table><tr><td class="bold">a</td></tr></table>`, {}, ".bold { font-weight: 700 }").rows[0]).toEqual(["a"]);
  });
});

describe("cssColor", () => {
  it.each([
    ["rgb(255, 0, 0)", "FF0000"],
    ["rgb(255 128 0)", "FF8000"],
    ["rgba(0, 0, 255, 0.5)", "0000FF"],
    ["rgb(0 0 255 / 50%)", "0000FF"],
    ["rgba(0, 0, 0, 0)", undefined],
    ["transparent", undefined],
    ["#abc", "AABBCC"],
    ["#AABBCC", "AABBCC"],
    ["#aabbcc80", "AABBCC"],
    ["#aabbcc00", undefined],
    ["red", "FF0000"],
    ["rebeccapurple", undefined],
    ["", undefined],
    ["rgb(none 128 none)", "008000"],
    ["hsl(120, 100%, 25%)", "008000"],
    ["hwb(0 0% 0%)", "FF0000"],
    ["hwb(0 60% 60%)", "808080"],
  ])("%j → %j", (input, expected) => {
    expect(cssColor(input)).toBe(expected);
  });
});

describe("cssColor: CSS Color 4 spaces", () => {
  // Reference values: the sRGB primaries, white and black as each space serialises them
  // (CSS Color 4 sample conversions, rounded as browsers print them).
  it.each([
    // OKLab / OKLCH
    ["oklch(62.8% 0.2577 29.23)", "FF0000"],
    ["oklch(0.628 0.2577 29.23)", "FF0000"],
    ["oklch(86.64% 0.2948 142.5)", "00FF00"],
    ["oklch(45.2% 0.3132 264.05)", "0000FF"],
    ["oklab(0.628 0.2249 0.1258)", "FF0000"],
    ["oklab(62.8% 56.225% 31.45%)", "FF0000"],
    ["oklch(1 0 0)", "FFFFFF"],
    ["oklch(100% 0 none)", "FFFFFF"],
    ["oklab(0 0 0)", "000000"],
    ["oklch(0.6 0 0)", "808080"], // L³ = Y = 0.216,
    // CIE Lab / LCH (D50, Bradford to D65)
    ["lab(54.29% 80.8 69.89)", "FF0000"],
    ["lab(54.29 80.8 69.89)", "FF0000"],
    ["lch(54.29% 106.84 40.85)", "FF0000"],
    ["lch(54.29% 106.84 0.7129rad)", "FF0000"],
    ["lab(87.82 -79.27 80.99)", "00FF00"],
    ["lab(29.57 68.29 -112.03)", "0000FF"],
    ["lab(100% 0 0)", "FFFFFF"],
    ["lab(0 0 0)", "000000"],
    ["lch(none none none)", "000000"],
    // color(): predefined spaces
    ["color(srgb 1 0 0)", "FF0000"],
    ["color(srgb 100% 50% 0%)", "FF8000"],
    ["color(srgb-linear 1 0.2158 0)", "FF8000"],
    ["color(display-p3 1 0 0)", "FF0000"], // outside sRGB: clipped
    ["color(display-p3 0.9175 0.2003 0.1386)", "FF0000"],
    ["color(display-p3 1 1 1)", "FFFFFF"],
    ["color(display-p3 0 0 0)", "000000"],
    ["color(a98-rgb 1 1 1)", "FFFFFF"],
    ["color(prophoto-rgb 1 1 1)", "FFFFFF"],
    ["color(rec2020 1 1 1)", "FFFFFF"],
    ["color(xyz-d65 0.9505 1 1.089)", "FFFFFF"],
    ["color(xyz 0.4124 0.2126 0.0193)", "FF0000"],
    ["color(xyz-d50 0.9642 1 0.8252)", "FFFFFF"],
    ["color(srgb none 1 none)", "00FF00"],
    // Tailwind v4 palette values as Chromium reports them
    ["oklch(0.623 0.214 259.815)", "2B7FFF"], // blue-500
    ["oklch(0.637 0.237 25.331)", "FB2C36"], // red-500
    ["oklch(0.967 0.003 264.542)", "F3F4F6"], // gray-100
  ])("%j → %j", (input, expected) => {
    expect(cssColor(input)).toBe(expected);
  });

  it("alpha: any non-zero alpha keeps the colour, zero or none is transparent", () => {
    expect(cssColor("oklch(0.628 0.2577 29.23 / 0.5)")).toBe("FF0000");
    expect(cssColor("lab(54.29 80.8 69.89 / 50%)")).toBe("FF0000");
    expect(cssColor("color(display-p3 1 0 0 / 0.25)")).toBe("FF0000");
    expect(cssColor("oklab(0.628 0.2249 0.1258 / 0)")).toBeUndefined();
    expect(cssColor("color(srgb 1 0 0 / 0%)")).toBeUndefined();
    expect(cssColor("lch(54.29 106.84 40.85 / none)")).toBeUndefined();
  });

  it("malformed or unknown forms are undefined", () => {
    for (const v of ["oklch(0.5 0.1)", "lab(1 2 3 4)", "color(unknown 1 0 0)", "color(srgb 1 0)", "oklch(a b c)", "lab(1 2 3 / )", "lab(1 2 3 / 1 / 1)", "color-mix(in srgb, red, blue)"]) {
      expect(cssColor(v), v).toBeUndefined();
    }
  });
});
