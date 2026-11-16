// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { download, DOWNLOAD_REVOKE_DELAY_MS } from "../../src/dom";

describe("download", () => {
  let created: Blob[];
  let revoked: string[];
  let clicks: Array<{ href: string; download: string; inDocument: boolean }>;

  beforeEach(() => {
    vi.useFakeTimers();
    created = [];
    revoked = [];
    clicks = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((b: Blob | MediaSource) => {
      created.push(b as Blob);
      return `blob:test/${created.length}`;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((u: string) => {
      revoked.push(u);
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download, inDocument: document.body.contains(this) });
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("clicks a temporary <a download> with an object URL, removes it, and revokes the URL later", () => {
    download(new Uint8Array([1, 2, 3]), "report.xlsx");
    expect(clicks).toEqual([{ href: "blob:test/1", download: "report.xlsx", inDocument: true }]);
    expect(document.querySelectorAll("a")).toHaveLength(0);
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(DOWNLOAD_REVOKE_DELAY_MS - 1);
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(revoked).toEqual(["blob:test/1"]);
  });

  it("picks the MIME type from the data and the file extension", async () => {
    download(new Uint8Array([1]), "a.xlsx");
    download("a,b\n", "a.csv");
    download("hello", "notes.txt");
    download(new Uint8Array([1]), "data.bin");
    download("x", "x.xlsx", { mimeType: "application/x-custom" });
    expect(created.map((b) => b.type)).toEqual([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv;charset=utf-8",
      "text/plain;charset=utf-8",
      "application/octet-stream",
      "application/x-custom",
    ]);
    expect(await created[2]!.text()).toBe("hello");
  });

  it("passes a Blob through, re-typed only when mimeType differs", () => {
    const blob = new Blob(["x"], { type: "text/csv" });
    download(blob, "a.csv");
    download(blob, "a.csv", { mimeType: "text/csv" });
    download(blob, "a.csv", { mimeType: "text/plain" });
    expect(created[0]).toBe(blob);
    expect(created[1]).toBe(blob);
    expect(created[2]).not.toBe(blob);
    expect(created[2]!.type).toBe("text/plain");
  });

  it("revokes even when the click throws", () => {
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    expect(() => download("x", "x.txt")).toThrow("blocked");
    expect(document.querySelectorAll("a")).toHaveLength(0);
    vi.runAllTimers();
    expect(revoked).toEqual(["blob:test/1"]);
  });

  it("rejects an empty filename", () => {
    expect(() => download("x", "")).toThrow(TypeError);
  });
});
