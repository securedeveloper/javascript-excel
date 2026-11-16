import { VERSION } from "javascript-excel";
import { readTab } from "./read-tab";
import { tableTab } from "./table-tab";
import { el } from "./util";
import { writeTab } from "./write-tab";
import "./style.css";

const TABS = [
  { id: "write", label: "Write", init: writeTab },
  { id: "read", label: "Read", init: readTab },
  { id: "table", label: "Table", init: tableTab },
] as const;

function banner(): HTMLElement {
  return el(
    "aside",
    { className: "banner", ariaLabel: "Prerelease notice" },
    el("strong", {}, "Prerelease. "),
    `javascript-excel ${VERSION} is an alpha on the npm "next" tag; the API can still change before 2.0.0. `,
    "Everything runs in your browser: no uploads, no tracking, no cookies.",
  );
}

function tabs(root: HTMLElement): void {
  const list = el("div", { className: "tablist" });
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-label", "Playground sections");
  const buttons: HTMLButtonElement[] = [];
  const panels: HTMLElement[] = [];
  const initialised = new Set<string>();

  const select = (index: number, focus: boolean): void => {
    TABS.forEach((t, i) => {
      const on = i === index;
      buttons[i]!.setAttribute("aria-selected", String(on));
      buttons[i]!.tabIndex = on ? 0 : -1;
      panels[i]!.hidden = !on;
      if (on && !initialised.has(t.id)) {
        initialised.add(t.id);
        t.init(panels[i]!);
      }
    });
    if (focus) buttons[index]!.focus();
    const hash = `#${TABS[index]!.id}`;
    if (location.hash !== hash) history.replaceState(null, "", hash);
  };

  TABS.forEach((t, i) => {
    const b = el("button", { type: "button", id: `tab-${t.id}` }, t.label);
    b.setAttribute("role", "tab");
    b.setAttribute("aria-controls", `panel-${t.id}`);
    b.addEventListener("click", () => select(i, false));
    b.addEventListener("keydown", (e) => {
      const n = TABS.length;
      const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
      if (next >= 0) {
        e.preventDefault();
        select(next, true);
      }
    });
    const p = el("section", { id: `panel-${t.id}`, className: "panel" });
    p.setAttribute("role", "tabpanel");
    p.setAttribute("aria-labelledby", `tab-${t.id}`);
    p.tabIndex = 0;
    buttons.push(b);
    panels.push(p);
    list.append(b);
  });
  root.append(list, ...panels);
  const fromHash = (): number => Math.max(0, TABS.findIndex((t) => `#${t.id}` === location.hash));
  window.addEventListener("hashchange", () => select(fromHash(), false));
  select(fromHash(), false);
}

const app = document.querySelector<HTMLElement>("#app");
if (app) {
  const header = el(
    "header",
    {},
    el("h1", {}, "javascript-excel playground"),
    el("p", { className: "lead" }, "Write, read and convert .xlsx and .csv with the real library, a zero-dependency TypeScript engine."),
  );
  const footer = el(
    "footer",
    {},
    el("p", {}, `Package version ${VERSION}. MIT licence. `, el("a", { href: "https://github.com/securedeveloper/javascript-excel" }, "Source on GitHub"), "."),
  );
  app.before(banner());
  app.append(header);
  tabs(app);
  app.after(footer);
}
