// Real Chromium: the browser's own UA stylesheet and computed styles, native
// CompressionStream, Blob and anchor downloads.
import { afterEach, describe, expect, it } from "vitest";
import { download, fromTable } from "../../src/dom";
import { toBlob, toUint8Array, XLSX_MIME, type Cell } from "../../src/index";
import { openZip } from "../../src/internal/zip/read";

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

function table(html: string, css = ""): HTMLTableElement {
  document.head.innerHTML = css ? `<style>${css}</style>` : "";
  document.body.innerHTML = html;
  return document.querySelector("table")!;
}

describe("fromTable in Chromium", () => {
  it("maps the UA stylesheet: <th> is bold and centred", () => {
    const s = fromTable(table("<table><tbody><tr><th>row head</th><td>cell</td></tr></tbody></table>"), { styles: "computed" });
    const [th, td] = s.rows[0]! as Array<Cell | string>;
    expect((th as Cell).style).toMatchObject({ font: { bold: true }, alignment: { horizontal: "center" } });
    expect(td).toBe("cell");
  });

  it("maps computed styles from stylesheets, inheritance and the row background", () => {
    const s = fromTable(
      table(
        `<table><tr class="band"><td class="a">a</td><td class="b">b</td><td class="c">c</td></tr></table>`,
        `.band { background: #ddebf7; font-style: italic } .a { font-weight: 600 } .b { color: #c00000; text-decoration: underline line-through } .c { text-align: right; vertical-align: top; white-space: pre-line }`,
      ),
      { styles: "computed" },
    );
    const [a, b, c] = s.rows[0]! as Cell[];
    expect(a!.style).toEqual({ font: { bold: true, italic: true }, fill: "DDEBF7" });
    expect(b!.style).toEqual({ font: { italic: true, underline: true, strike: true, color: "C00000" }, fill: "DDEBF7" });
    expect(c!.style).toEqual({ font: { italic: true }, fill: "DDEBF7", alignment: { horizontal: "right", vertical: "top", wrapText: true } });
  });

  it("skips rows hidden by CSS, resolves relative links, and reads RTL from computed direction", () => {
    const s = fromTable(
      table(`<div class="rtl"><table><tr class="gone"><td>x</td></tr><tr><td><a href="page?q=1">link</a></td></tr></table></div>`, `.gone { display: none } .rtl { direction: rtl }`),
      { styles: "computed" },
    );
    expect(s.rows).toEqual([[{ value: "link", hyperlink: new URL("page?q=1", document.baseURI).href }]]);
    expect(s.view).toEqual({ rightToLeft: true });
  });

  it("round-trips through the writer with native CompressionStream", async () => {
    const sheet = fromTable(
      table(`<table><thead><tr><th colspan="2">Group</th></tr></thead><tbody><tr><td data-type="number">1.5</td><td>été</td></tr></tbody></table>`),
      { freezeHeader: true },
    );
    const zip = openZip(await toUint8Array({ sheets: [sheet] }));
    const xml = new TextDecoder().decode(await zip.read("xl/worksheets/sheet1.xml"));
    expect(xml).toContain('<mergeCell ref="A1:B1"/>');
    expect(xml).toContain('<c r="A2"><v>1.5</v></c>');
    expect(xml).toContain('state="frozen"');
    const sst = new TextDecoder().decode(await zip.read("xl/sharedStrings.xml"));
    expect(sst).toContain("<t>été</t>");
    const blob = await toBlob({ sheets: [sheet] });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe(XLSX_MIME);
  });
});

describe("download in Chromium", () => {
  it("clicks an <a download> with a blob: URL that holds the file", async () => {
    const seen: Array<{ href: string; name: string; bytes: number }> = [];
    const pending: Array<Promise<void>> = [];
    const onClick = (e: MouseEvent): void => {
      const a = e.target as HTMLAnchorElement;
      if (a.tagName !== "A") return;
      e.preventDefault(); // keep the test page from navigating or saving
      pending.push(
        fetch(a.href)
          .then((r) => r.arrayBuffer())
          .then((buf) => {
            seen.push({ href: a.href.slice(0, 5), name: a.download, bytes: buf.byteLength });
          }),
      );
    };
    document.addEventListener("click", onClick, true);
    try {
      download(new Uint8Array([80, 75, 3, 4]), "book.xlsx");
      download("a,b\r\n", "data.csv");
      await Promise.all(pending);
    } finally {
      document.removeEventListener("click", onClick, true);
    }
    expect(seen).toEqual([
      { href: "blob:", name: "book.xlsx", bytes: 4 },
      { href: "blob:", name: "data.csv", bytes: 5 },
    ]);
    expect(document.querySelectorAll("a")).toHaveLength(0);
  });
});
