/**
 * Shared strings (xl/sharedStrings.xml) and inline strings (<is>). Internal.
 *
 * `<si>`/`<is>` hold either one `<t>` (plain text) or `<r>` runs with optional
 * `<rPr>` fonts. Phonetic runs (`<rPh>`) are not part of the cell text and are
 * skipped. Text is ST_Xstring: `_xHHHH_` escapes are decoded.
 */

import { LimitError } from "../../errors";
import type { RichText, RichTextRun } from "../../model";
import { FontBuilder } from "./styles";
import type { XmlAttrs, XmlHandler } from "./xml-reader";

/** Decodes ST_Xstring `_xHHHH_` escapes (`_x005F_` is a literal underscore). */
export function decodeXstring(s: string): string {
  if (s.indexOf("_x") === -1) return s;
  return s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Collects one string item (<si> or <is>). Feed it the events between the
 * item's open and close; `value()` gives the string or rich text.
 */
export class StringItem {
  private runs: RichTextRun[] = [];
  private plain = "";
  private hasRuns = false;
  private inT = false;
  private inRun = false;
  private inRPh = 0;
  private runText = "";
  private font: FontBuilder | undefined;
  private inRPr = false;

  open(name: string, a: XmlAttrs): void {
    if (this.inRPh > 0) {
      this.inRPh++;
      return;
    }
    switch (name) {
      case "rPh":
        this.inRPh = 1;
        return;
      case "r":
        this.inRun = true;
        this.hasRuns = true;
        this.runText = "";
        this.font = undefined;
        return;
      case "rPr":
        this.inRPr = true;
        this.font = new FontBuilder();
        return;
      case "t":
        this.inT = true;
        return;
      default:
        if (this.inRPr) this.font?.child(name, a);
    }
  }

  close(name: string): void {
    if (this.inRPh > 0) {
      this.inRPh--;
      return;
    }
    switch (name) {
      case "t":
        this.inT = false;
        return;
      case "rPr":
        this.inRPr = false;
        return;
      case "r": {
        const run: RichTextRun = { text: decodeXstring(this.runText) };
        if (this.font && Object.keys(this.font.font).length) run.font = this.font.font;
        this.runs.push(run);
        this.inRun = false;
        return;
      }
      default:
        return;
    }
  }

  text(s: string): void {
    if (!this.inT || this.inRPh > 0) return;
    if (this.inRun) this.runText += s;
    else this.plain += s;
  }

  value(mode: "runs" | "plain"): string | RichText {
    if (!this.hasRuns) return decodeXstring(this.plain);
    if (mode === "plain") return this.runs.map((r) => r.text).join("");
    return { richText: this.runs };
  }
}

/** Handler for sharedStrings.xml. */
export class SharedStringsParser implements XmlHandler {
  readonly strings: Array<string | RichText> = [];
  private item: StringItem | undefined;
  private depth = 0;

  constructor(
    private readonly mode: "runs" | "plain",
    private readonly max: number,
  ) {}

  open(name: string, a: XmlAttrs, empty: boolean): void {
    if (this.item) {
      if (!empty) this.depth++;
      this.item.open(name, a);
      if (empty) this.item.close(name);
      return;
    }
    if (name === "si") {
      if (this.strings.length >= this.max) {
        throw new LimitError("LIMIT_EXCEEDED", `More than maxSharedStrings (${this.max}) shared strings.`, {
          details: { limit: "maxSharedStrings", value: this.strings.length + 1, max: this.max },
        });
      }
      if (empty) this.strings.push("");
      else {
        this.item = new StringItem();
        this.depth = 0;
      }
    }
  }

  close(name: string): void {
    if (!this.item) return;
    if (this.depth === 0 && name === "si") {
      this.strings.push(this.item.value(this.mode));
      this.item = undefined;
      return;
    }
    this.depth--;
    this.item.close(name);
  }

  text(s: string): void {
    this.item?.text(s);
  }
}
