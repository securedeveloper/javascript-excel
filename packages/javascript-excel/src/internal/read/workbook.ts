/**
 * xl/workbook.xml, the theme and the document properties. Internal.
 */

import type { DefinedName, DocProperties, Theme } from "../../model";
import { bool, int } from "./styles";
import type { XmlAttrs, XmlHandler } from "./xml-reader";
import { parseIsoDate } from "../csv/infer";

export interface SheetEntry {
  name: string;
  relId: string | undefined;
  state: "visible" | "hidden" | "veryHidden";
}

export class WorkbookParser implements XmlHandler {
  readonly sheets: SheetEntry[] = [];
  readonly definedNames: DefinedName[] = [];
  date1904 = false;
  activeTab: number | undefined;
  fullCalcOnLoad: boolean | undefined;
  /** The root element's namespace, to tell Strict from transitional. */
  rootNamespace: string | undefined;
  private name: DefinedName | undefined;
  private nameText = "";
  private seenView = false;

  open(name: string, a: XmlAttrs, empty: boolean): void {
    switch (name) {
      case "workbook":
        this.rootNamespace = a.get("xmlns") ?? [...a.entries()].find(([k]) => k.startsWith("xmlns:"))?.[1];
        return;
      case "workbookPr":
        this.date1904 = bool(a.get("date1904"), false);
        return;
      case "workbookView":
        if (!this.seenView) {
          this.seenView = true;
          this.activeTab = int(a.get("activeTab"));
        }
        return;
      case "sheet": {
        const n = a.get("name");
        if (n === undefined) return;
        const st = a.get("state");
        this.sheets.push({ name: n, relId: a.getPrefixed("id"), state: st === "hidden" || st === "veryHidden" ? st : "visible" });
        return;
      }
      case "definedName": {
        const n = a.get("name");
        if (n === undefined) return;
        const d: DefinedName = { name: n, ref: "" };
        const local = int(a.get("localSheetId"));
        if (local !== undefined) d.sheet = local;
        if (a.get("hidden") !== undefined) d.hidden = bool(a.get("hidden"));
        const comment = a.get("comment");
        if (comment !== undefined) d.comment = comment;
        this.nameText = "";
        if (empty) this.definedNames.push(d);
        else this.name = d;
        return;
      }
      case "calcPr":
        if (a.get("fullCalcOnLoad") !== undefined) this.fullCalcOnLoad = bool(a.get("fullCalcOnLoad"));
        return;
      default:
        return;
    }
  }

  close(name: string): void {
    if (name === "definedName" && this.name) {
      this.name.ref = this.nameText;
      this.definedNames.push(this.name);
      this.name = undefined;
    }
  }

  text(s: string): void {
    if (this.name) this.nameText += s;
  }
}

const SCHEME_ORDER = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];

export class ThemeParser implements XmlHandler {
  private readonly colors = new Map<string, string>();
  private slot: string | undefined;
  private fontGroup: "major" | "minor" | undefined;
  major: string | undefined;
  minor: string | undefined;
  private inScheme = false;

  open(name: string, a: XmlAttrs): void {
    if (name === "clrScheme") this.inScheme = true;
    else if (this.inScheme && SCHEME_ORDER.includes(name)) this.slot = name;
    else if (this.slot && (name === "srgbClr" || name === "sysClr")) {
      const v = name === "srgbClr" ? a.get("val") : (a.get("lastClr") ?? a.get("val"));
      if (v && /^[0-9A-Fa-f]{6}$/.test(v) && !this.colors.has(this.slot)) this.colors.set(this.slot, `FF${v.toUpperCase()}`);
    } else if (name === "majorFont") this.fontGroup = "major";
    else if (name === "minorFont") this.fontGroup = "minor";
    else if (name === "latin" && this.fontGroup) {
      const tf = a.get("typeface");
      if (tf !== undefined) this[this.fontGroup] = tf;
    }
  }

  close(name: string): void {
    if (name === "clrScheme") this.inScheme = false;
    else if (name === this.slot) this.slot = undefined;
    else if (name === "majorFont" || name === "minorFont") this.fontGroup = undefined;
  }

  text(): void {}

  result(): Theme | undefined {
    if (this.colors.size === 0 && this.major === undefined && this.minor === undefined) return undefined;
    const t: Theme = { colors: SCHEME_ORDER.map((k) => this.colors.get(k) ?? "") };
    if (this.major !== undefined) t.majorFont = this.major;
    if (this.minor !== undefined) t.minorFont = this.minor;
    return t;
  }
}

const CORE_FIELDS: Record<string, keyof DocProperties> = {
  title: "title",
  subject: "subject",
  creator: "creator",
  keywords: "keywords",
  description: "description",
  lastModifiedBy: "lastModifiedBy",
  category: "category",
  created: "created",
  modified: "modified",
  Company: "company",
  Manager: "manager",
  Application: "application",
};

/** docProps/core.xml and docProps/app.xml: simple elements with text. */
export class PropsParser implements XmlHandler {
  private field: keyof DocProperties | undefined;
  private value = "";
  private depth = 0;

  constructor(readonly props: DocProperties) {}

  open(name: string, _a: XmlAttrs, empty: boolean): void {
    if (empty) return;
    this.depth++;
    // Only direct children of the root are properties.
    if (this.depth === 2 && Object.prototype.hasOwnProperty.call(CORE_FIELDS, name)) {
      this.field = CORE_FIELDS[name];
      this.value = "";
    }
  }

  close(): void {
    if (this.depth === 2 && this.field) {
      const f = this.field;
      const v = this.value;
      if (f === "created" || f === "modified") {
        const d = parseIsoDate(v.trim().replace(/(\.\d{3})\d+/, "$1"), "utc");
        if (d) this.props[f] = d;
      } else if (v !== "" && f !== "custom") (this.props as Record<string, unknown>)[f] = v;
      this.field = undefined;
    }
    this.depth--;
  }

  text(s: string): void {
    if (this.field) this.value += s;
  }
}

/** docProps/custom.xml. */
export class CustomPropsParser implements XmlHandler {
  readonly items: Array<{ name: string; value: string | number | boolean | Date }> = [];
  private name: string | undefined;
  private kind: string | undefined;
  private value = "";

  open(name: string, a: XmlAttrs): void {
    if (name === "property") {
      this.name = a.get("name");
      this.kind = undefined;
    } else if (this.name !== undefined && this.kind === undefined) {
      this.kind = name;
      this.value = "";
    }
  }

  close(name: string): void {
    if (name === "property") {
      this.name = undefined;
      return;
    }
    if (this.name === undefined || name !== this.kind) return;
    const v = this.value;
    let out: string | number | boolean | Date | undefined;
    switch (name) {
      case "lpwstr":
      case "lpstr":
      case "bstr":
        out = v;
        break;
      case "bool":
        out = v === "true" || v === "1";
        break;
      case "filetime":
      case "date":
        out = parseIsoDate(v.trim(), "utc");
        break;
      default:
        if (/^(i[1248]|ui[1248]|int|uint|r4|r8|decimal)$/.test(name)) {
          const n = Number(v);
          if (Number.isFinite(n)) out = n;
        }
    }
    if (out !== undefined) this.items.push({ name: this.name, value: out });
    this.kind = "";
  }

  text(s: string): void {
    if (this.kind) this.value += s;
  }
}
