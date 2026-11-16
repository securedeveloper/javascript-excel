import { describe, expect, it } from "vitest";
import { XmlTokenizer, type XmlAttrs } from "../../src/internal/read/xml-reader";

type Ev = ["open", string, Array<[string, string]>, boolean] | ["close", string] | ["text", string];

function tokenize(xml: string, chunk = Infinity, maxDepth = 64): Ev[] {
  const ev: Ev[] = [];
  let text = "";
  const flush = () => {
    if (text) ev.push(["text", text]);
    text = "";
  };
  const tok = new XmlTokenizer(
    {
      open: (n: string, a: XmlAttrs, e: boolean) => {
        flush();
        ev.push(["open", n, [...a.entries()], e]);
      },
      close: (n: string) => {
        flush();
        ev.push(["close", n]);
      },
      text: (t: string) => {
        text += t;
      },
    },
    maxDepth,
  );
  if (chunk === Infinity) tok.feed(xml);
  else for (let i = 0; i < xml.length; i += chunk) tok.feed(xml.slice(i, i + chunk));
  tok.end();
  flush();
  return ev;
}

const SAMPLE =
  '<?xml version="1.0" encoding="UTF-8"?>\r\n<!-- c --><x:root xmlns:x="u" a="1" b=\'two &amp; &lt;3&gt;\'>' +
  "<x:row r=\"1\"><x:c r=\"A1\" t=\"s\"><x:v>12</x:v></x:c><empty/></x:row>" +
  "<t>a &amp; b &#x1F600; &#65;\r\nline</t><![CDATA[<raw> & stuff]]><?pi ignored?></x:root>";

describe("XML tokenizer", () => {
  it("emits local names, attributes, text, CDATA; skips declarations, comments and PIs", () => {
    expect(tokenize(SAMPLE)).toEqual([
      ["open", "root", [["xmlns:x", "u"], ["a", "1"], ["b", "two & <3>"]], false],
      ["open", "row", [["r", "1"]], false],
      ["open", "c", [["r", "A1"], ["t", "s"]], false],
      ["open", "v", [], false],
      ["text", "12"],
      ["close", "v"],
      ["close", "c"],
      ["open", "empty", [], true],
      ["close", "row"],
      ["open", "t", [], false],
      ["text", "a & b 😀 A\nline"],
      ["close", "t"],
      ["text", "<raw> & stuff"],
      ["close", "root"],
    ]);
  });

  it.each([1, 2, 3, 5, 7, 13])("gives the same events when fed %i characters at a time", (n) => {
    expect(tokenize(SAMPLE, n)).toEqual(tokenize(SAMPLE));
  });

  it("normalises newlines in text (CRLF and CR -> LF), also across chunk boundaries", () => {
    expect(tokenize("<a>x\r\ny\rz</a>", 2)).toEqual([["open", "a", [], false], ["text", "x\ny\nz"], ["close", "a"]]);
  });

  it("normalises whitespace in attribute values but keeps character references", () => {
    expect(tokenize('<a v="x\ty\nz&#10;w"/>')).toEqual([["open", "a", [["v", "x y z\nw"]], true]]);
  });

  it("'>' inside attribute values does not end the tag", () => {
    expect(tokenize('<a v="1>2" w=\'>\'/>', 3)).toEqual([["open", "a", [["v", "1>2"], ["w", ">"]], true]]);
  });

  it("XmlAttrs.get / getPrefixed", () => {
    let attrs: XmlAttrs | undefined;
    new XmlTokenizer({ open: (_n, a) => (attrs = a), close: () => {}, text: () => {} }, 64).feed('<s id="plain" r:id="rId1" xml:space="preserve"/>');
    expect(attrs!.get("id")).toBe("plain");
    expect(attrs!.getPrefixed("id")).toBe("rId1");
    expect(attrs!.getPrefixed("space")).toBeUndefined();
    expect(attrs!.getQualified("xml:space")).toBe("preserve");
  });

  describe("rejects", () => {
    const code = (xml: string, maxDepth = 64) => {
      try {
        tokenize(xml, Infinity, maxDepth);
      } catch (e) {
        return (e as { code?: string; name?: string }).code;
      }
      return "ok";
    };
    it.each([
      ['<!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>', "XML_DTD_FORBIDDEN"],
      ["<!doctype x><x/>", "XML_DTD_FORBIDDEN"],
      ['<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><lolz>&lol2;</lolz>', "XML_DTD_FORBIDDEN"],
      ["<x>&lol;</x>", "XML_MALFORMED"],
      ["<x>&#0;</x>", "XML_MALFORMED"],
      ["<x>&#xD800;</x>", "XML_MALFORMED"],
      ["<x>&#x110000;</x>", "XML_MALFORMED"],
      ["<x>& </x>", "XML_MALFORMED"],
      ["<x><y></x>", "XML_MALFORMED"],
      ["<x>", "XML_MALFORMED"],
      ["</x>", "XML_MALFORMED"],
      ["<x a=1/>", "XML_MALFORMED"],
      ['<x a="1/>', "XML_MALFORMED"],
      ['<x a="<"/>', "XML_MALFORMED"],
      ["<x/><y/>", "XML_MALFORMED"],
      ["text<x/>", "XML_MALFORMED"],
      ["", "XML_MALFORMED"],
      ["<x><!-- unterminated </x>", "XML_MALFORMED"],
      ["<x><![CDATA[ unterminated </x>", "XML_MALFORMED"],
    ])("%j -> %s", (xml, expected) => {
      expect(code(xml)).toBe(expected);
    });
    it("nesting deeper than maxXmlDepth -> LIMIT_EXCEEDED (maxXmlDepth)", () => {
      const deep = "<a>".repeat(10) + "</a>".repeat(10);
      expect(code(deep, 10)).toBe("ok");
      expect(code(deep, 9)).toBe("LIMIT_EXCEEDED");
    });
    it("a billion-laughs payload never expands (it is rejected before any entity is defined)", () => {
      const lol = ['<!DOCTYPE lolz [<!ENTITY lol "lol">'];
      for (let i = 1; i < 10; i++) lol.push(`<!ENTITY lol${i} "${`&lol${i === 1 ? "" : i - 1};`.repeat(10)}">`);
      lol.push("]><lolz>&lol9;</lolz>");
      expect(code(lol.join(""))).toBe("XML_DTD_FORBIDDEN");
    });
  });

  it("is linear on long text and many attributes", () => {
    const t0 = Date.now();
    tokenize(`<x>${"a".repeat(5_000_000)}</x>`, 65_536);
    tokenize(`<x ${Array.from({ length: 20_000 }, (_, i) => `a${i}="${i}"`).join(" ")}/>`);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
