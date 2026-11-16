import { describe, expect, it } from "vitest";
import { CONTENT_TYPE, PackageParts, Rels, REL_TYPE } from "../../src/internal/write/package";

describe("package registry", () => {
  it("allocates relationship ids in order and reuses identical relationships", () => {
    const rels = new Rels();
    expect(rels.xml()).toBeUndefined();
    expect(rels.add(REL_TYPE.hyperlink, "https://a.example/?x=1&y=2", true)).toBe("rId1");
    expect(rels.add("http://example.com/rel/drawing", "../drawings/drawing1.xml")).toBe("rId2");
    expect(rels.add(REL_TYPE.hyperlink, "https://a.example/?x=1&y=2", true)).toBe("rId1");
    expect(rels.add(REL_TYPE.hyperlink, "https://a.example/?x=1&y=2", false)).toBe("rId3");
    expect(rels.size).toBe(3);
    const x = rels.xml()!;
    expect(x).toContain('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://a.example/?x=1&amp;y=2" TargetMode="External"/>');
    expect(x).toContain('<Relationship Id="rId2" Type="http://example.com/rel/drawing" Target="../drawings/drawing1.xml"/>');
  });

  it("lets later parts add content-type defaults and overrides", () => {
    const pkg = new PackageParts();
    pkg.addOverride("xl/workbook.xml", CONTENT_TYPE.workbook);
    pkg.addDefault("PNG", "image/png");
    pkg.addOverride("xl/comments1.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml");
    const x = pkg.contentTypesXml();
    expect(x).toContain('<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>');
    expect(x.indexOf('PartName="/xl/workbook.xml"')).toBeLessThan(x.indexOf('PartName="/xl/comments1.xml"'));
  });
});
