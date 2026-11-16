// @vitest-environment happy-dom
import { fromDataset, type Sheet } from "javascript-excel";
import { describe, expect, it } from "vitest";
import { cssColor, renderSheet } from "../src/render";

const table = (el: HTMLElement): HTMLTableElement => el.querySelector("table")!;

describe("cssColor", () => {
  it("resolves rgb, argb, theme (with the dk/lt swap), tints and indexed colours", () => {
    expect(cssColor("FF0000", undefined)).toBe("#FF0000");
    expect(cssColor({ rgb: "FF00B050" }, undefined)).toBe("#00B050");
    expect(cssColor({ theme: 0 }, undefined)).toBe("#FFFFFF"); // lt1
    expect(cssColor({ theme: 1 }, undefined)).toBe("#000000"); // dk1
    expect(cssColor({ theme: 4 }, undefined)).toBe("#4472C4"); // accent1
    expect(cssColor({ theme: 4, tint: 0.6 }, undefined)).toBe("#b4c7e7");
    expect(cssColor({ theme: 4 }, { colors: ["FF111111", "FFEEEEEE", "FF222222", "FFDDDDDD", "FFABCDEF"] })).toBe("#ABCDEF");
    expect(cssColor({ indexed: 10 }, undefined)).toBe("#FF0000");
    expect(cssColor({ auto: true }, undefined)).toBeUndefined();
    expect(cssColor(undefined, undefined)).toBeUndefined();
  });
});

describe("renderSheet", () => {
  it("never interprets cell text as HTML (files on the Read tab are untrusted)", () => {
    const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const sheet: Sheet = { name: "<b>x</b>", rows: [[payload, { value: payload, formula: '"<i>"' }]] };
    const out = renderSheet(sheet);
    expect(out.querySelector("img, script, b, i")).toBeNull();
    const cells = table(out).querySelectorAll("tbody td");
    expect(cells[0]!.textContent).toBe(payload);
    expect(table(out).caption!.textContent).toBe("<b>x</b>");
  });

  it("renders merges as colspan/rowspan and skips covered cells", () => {
    const sheet: Sheet = { name: "M", rows: [["a", null, "c"], [null, null, "f"]], merges: ["A1:B2"] };
    const rows = table(renderSheet(sheet)).querySelectorAll("tbody tr");
    const first = rows[0]!.querySelectorAll("th, td"); // th + td(a, spans 2x2) + td(c)
    expect(first.length).toBe(3);
    expect((first[1] as HTMLTableCellElement).colSpan).toBe(2);
    expect((first[1] as HTMLTableCellElement).rowSpan).toBe(2);
    expect(rows[1]!.querySelectorAll("th, td").length).toBe(2); // th + f
  });

  it("applies basic styles and marks numbers", () => {
    const sheet = fromDataset({ columns: [{ title: "N", key: "n" }], data: [{ n: 5 }] }, { headerStyle: { font: { bold: true, color: "FF0000" }, fill: "FFFF00", alignment: { horizontal: "center" } } });
    const tds = table(renderSheet(sheet)).querySelectorAll("tbody td");
    const header = tds[0] as HTMLTableCellElement;
    expect(header.style.fontWeight).toBe("700");
    expect(header.style.textAlign).toBe("center");
    expect(header.style.color).not.toBe("");
    expect(header.style.backgroundColor).not.toBe("");
    expect(tds[1]!.classList.contains("num")).toBe(true);
  });

  it("caps the preview and says so", () => {
    const rows = Array.from({ length: 300 }, (_, r) => [r]);
    const out = renderSheet({ name: "Big", rows }, { maxRows: 50 });
    expect(table(out).querySelectorAll("tbody tr").length).toBe(50);
    expect(out.textContent).toContain("first 50 rows");
  });
});
