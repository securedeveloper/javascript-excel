import { isExcelError, type ExcelWarning } from "javascript-excel";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
}

/** A checkbox with its label. */
export function checkbox(id: string, label: string, checked = false): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = el("input", { type: "checkbox", id, checked });
  const wrap = el("div", { className: "check" }, input, el("label", { htmlFor: id }, label));
  return { wrap, input };
}

/** Human-readable error text, with the library's error code when there is one. */
export function describeError(e: unknown): string {
  if (isExcelError(e)) return `${e.code}: ${e.message}`;
  if (e instanceof Error) return e.name === "AbortError" ? "Cancelled." : `${e.name}: ${e.message}`;
  return String(e);
}

/** Shows a status line in a live region. */
export function status(region: HTMLElement, text: string, kind: "info" | "error" = "info"): void {
  region.textContent = text;
  region.className = `status ${kind}`;
}

export function warningList(warnings: ExcelWarning[]): HTMLElement {
  if (warnings.length === 0) return el("p", { className: "hint" }, "No warnings.");
  const list = el("ul", { className: "warnings" });
  for (const w of warnings) list.append(el("li", {}, el("code", {}, w.code), ` ${w.sheet ? `${w.sheet}${w.ref ? `!${w.ref}` : ""}: ` : ""}${w.message}`));
  return list;
}
