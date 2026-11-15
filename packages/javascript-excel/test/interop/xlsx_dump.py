"""Dump an .xlsx file as JSON with openpyxl, for test/write/golden.test.ts.

  python3 xlsx_dump.py <file.xlsx> [values]

With "values", cells carry only their value (for very large sheets).

Prints workbook structure, document properties and, for every cell, its
value (formula text and cached value), number format and full style.
"""

import datetime
import json
import sys

import openpyxl
from openpyxl.cell.rich_text import CellRichText, TextBlock


def color(c):
    if c is None:
        return None
    t = c.type
    if t == "rgb":
        return {"rgb": c.rgb}
    if t == "theme":
        return {"theme": c.theme, "tint": c.tint}
    if t == "indexed":
        return {"indexed": c.indexed}
    if t == "auto":
        return {"auto": True}
    return {"type": t}


def plain(v):
    """Unwraps openpyxl's nested descriptor values (used by rich-text InlineFont)."""
    return getattr(v, "val", v)


def font(f):
    if f is None:
        return None
    # InlineFont (rich-text runs) stores the typeface in rFont.
    name = getattr(f, "rFont", None) if hasattr(f, "rFont") else f.name
    return {
        "name": plain(name),
        "size": plain(f.sz),
        "bold": bool(f.b),
        "italic": bool(f.i),
        "underline": plain(f.u),
        "strike": bool(f.strike),
        "vertAlign": plain(f.vertAlign),
        "color": color(f.color),
        "family": plain(f.family),
        "charset": plain(f.charset),
        "scheme": plain(f.scheme),
        "outline": bool(f.outline),
        "shadow": bool(f.shadow),
        "condense": bool(f.condense),
        "extend": bool(f.extend),
    }


def fill(f):
    if f.tagname == "gradientFill":
        return {
            "gradient": f.type,
            "degree": f.degree,
            "left": f.left,
            "right": f.right,
            "top": f.top,
            "bottom": f.bottom,
            "stops": [{"position": s.position, "color": color(s.color)} for s in f.stop],
        }
    return {"pattern": f.patternType, "fgColor": color(f.fgColor), "bgColor": color(f.bgColor)}


def side(s):
    return {"style": s.style, "color": color(s.color)} if s is not None and s.style else None


def border(b):
    return {
        "left": side(b.left),
        "right": side(b.right),
        "top": side(b.top),
        "bottom": side(b.bottom),
        "diagonal": side(b.diagonal),
        "diagonalUp": bool(b.diagonalUp),
        "diagonalDown": bool(b.diagonalDown),
    }


def alignment(a):
    return {
        "horizontal": a.horizontal,
        "vertical": a.vertical,
        "textRotation": a.textRotation,
        "wrapText": bool(a.wrapText),
        "shrinkToFit": bool(a.shrinkToFit),
        "indent": a.indent,
        "readingOrder": a.readingOrder,
        "justifyLastLine": bool(a.justifyLastLine),
    }


def value(v):
    if isinstance(v, (datetime.datetime, datetime.date, datetime.time)):
        return {"datetime": v.isoformat()}
    if isinstance(v, CellRichText):
        return {
            "richText": [
                {"text": b.text, "font": font(b.font)} if isinstance(b, TextBlock) else {"text": b}
                for b in v
            ]
        }
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    return {"repr": repr(v)}


def iso(d):
    return d.isoformat() if d else None


def main(path, values_only=False):
    wb = openpyxl.load_workbook(path, rich_text=True)
    cached = openpyxl.load_workbook(path, data_only=True)
    props = wb.properties
    out = {
        "sheets": [{"title": ws.title, "state": ws.sheet_state} for ws in wb.worksheets],
        "active": wb.index(wb.active),
        "epoch1904": wb.epoch == openpyxl.utils.datetime.MAC_EPOCH,
        "properties": {
            "title": props.title,
            "subject": props.subject,
            "creator": props.creator,
            "keywords": props.keywords,
            "description": props.description,
            "lastModifiedBy": props.lastModifiedBy,
            "category": props.category,
            "created": iso(props.created),
            "modified": iso(props.modified),
        },
        "custom": [{"name": p.name, "value": value(p.value)} for p in wb.custom_doc_props.props],
        "cellXfCount": len(wb._cell_styles),
        "cells": {},
    }
    for ws in wb.worksheets:
        cws = cached[ws.title]
        cells = {}
        for row in ws.iter_rows():
            for c in row:
                if c.value is None and not c.has_style:
                    continue
                if values_only:
                    cells[c.coordinate] = {"value": value(c.value)}
                    continue
                cells[c.coordinate] = {
                    "value": value(c.value),
                    "cached": value(cws[c.coordinate].value),
                    "dataType": c.data_type,
                    "numFmt": c.number_format,
                    "font": font(c.font),
                    "fill": fill(c.fill),
                    "border": border(c.border),
                    "alignment": alignment(c.alignment),
                    "protection": {"locked": c.protection.locked, "hidden": c.protection.hidden},
                }
        out["cells"][ws.title] = cells
    print(json.dumps(out))


if __name__ == "__main__":
    main(sys.argv[1], len(sys.argv) > 2 and sys.argv[2] == "values")
