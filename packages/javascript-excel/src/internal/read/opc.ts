/**
 * Open Packaging Conventions for the reader: part lookup (case-insensitive,
 * as OPC requires), [Content_Types].xml and relationship parts. Internal.
 */

import { FormatError } from "../../errors";
import type { ZipEntryInfo } from "../zip/read";
import type { ReadContext } from "./context";
import type { XmlAttrs } from "./xml-reader";

export interface Relationship {
  id: string;
  /** The type URI's last path segment, e.g. 'worksheet', 'officeDocument'. Transitional and Strict URIs agree on it. */
  kind: string;
  type: string;
  /** Resolved part name without a leading '/', or the raw target when external. */
  target: string;
  external: boolean;
}

export class Package {
  private readonly parts = new Map<string, ZipEntryInfo>();
  /** Part name (lower case, no leading '/') -> content type. */
  private readonly overrides = new Map<string, string>();
  /** Extension (lower case) -> content type. */
  private readonly defaults = new Map<string, string>();

  constructor(readonly ctx: ReadContext) {
    for (const e of ctx.zip.entries) {
      if (e.name.endsWith("/")) continue; // directory entries
      const key = e.name.toLowerCase();
      if (this.parts.has(key)) {
        throw new FormatError("ZIP_INVALID", `Part names ${this.parts.get(key)!.name} and ${e.name} differ only in case.`, {
          details: { entry: e.name },
        });
      }
      this.parts.set(key, e);
    }
  }

  part(name: string): ZipEntryInfo | undefined {
    return this.parts.get(stripSlash(name).toLowerCase());
  }

  get partNames(): string[] {
    return [...this.parts.values()].map((e) => e.name);
  }

  async loadContentTypes(): Promise<void> {
    const entry = this.part("[Content_Types].xml");
    if (!entry) return;
    await this.ctx.parse(entry, {
      open: (name, a) => {
        if (name === "Default") {
          const ext = a.get("Extension");
          const type = a.get("ContentType");
          if (ext && type) this.defaults.set(ext.toLowerCase(), type);
        } else if (name === "Override") {
          const part = a.get("PartName");
          const type = a.get("ContentType");
          if (part && type) this.overrides.set(stripSlash(part).toLowerCase(), type);
        }
      },
      close: () => {},
      text: () => {},
    });
  }

  contentType(name: string): string | undefined {
    const key = stripSlash(name).toLowerCase();
    const o = this.overrides.get(key);
    if (o) return o;
    const dot = key.lastIndexOf(".");
    return dot === -1 ? undefined : this.defaults.get(key.slice(dot + 1));
  }

  /** Content types of all overrides (for format detection). */
  get overrideTypes(): string[] {
    return [...this.overrides.values()];
  }

  /** Relationships of `source` ('' for the package). Missing rels part: []. */
  async rels(source: string): Promise<Relationship[]> {
    const src = stripSlash(source);
    const slash = src.lastIndexOf("/");
    const dir = slash === -1 ? "" : src.slice(0, slash + 1);
    const file = slash === -1 ? src : src.slice(slash + 1);
    const relsName = `${dir}_rels/${file}.rels`;
    const entry = this.part(relsName);
    if (!entry) return [];
    const out: Relationship[] = [];
    await this.ctx.parse(entry, {
      open: (name, a: XmlAttrs) => {
        if (name !== "Relationship") return;
        const id = a.get("Id");
        const type = a.get("Type");
        const target = a.get("Target");
        if (!id || !type || target === undefined) return;
        const external = (a.get("TargetMode") ?? "").toLowerCase() === "external";
        out.push({
          id,
          type,
          kind: type.slice(type.lastIndexOf("/") + 1),
          target: external ? target : resolveTarget(dir, target),
          external,
        });
      },
      close: () => {},
      text: () => {},
    });
    return out;
  }
}

function stripSlash(name: string): string {
  return name.startsWith("/") ? name.slice(1) : name;
}

/** Resolves a relationship target against the source part's folder (RFC 3986 dot segments, '%xx' decoded). */
export function resolveTarget(baseDir: string, target: string): string {
  let t = target;
  const hash = t.indexOf("#");
  if (hash !== -1) t = t.slice(0, hash);
  try {
    t = decodeURIComponent(t);
  } catch {
    // keep as is
  }
  t = t.replace(/\\/g, "/");
  const segments = t.startsWith("/") ? [] : baseDir.split("/").filter((s) => s !== "");
  for (const seg of t.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") segments.pop();
    else segments.push(seg);
  }
  return segments.join("/");
}
