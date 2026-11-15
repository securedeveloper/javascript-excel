"""CSV interop helper for test/csv/interop.test.ts.

  python3 csv_interop.py write <outdir>              writes reference files with Python's csv module
                                                     in several dialects and prints a JSON manifest
                                                     {file: {"delimiter", "encoding", "rows"}}
  python3 csv_interop.py read <file> <delimiter>     reads a UTF-8 (optionally BOM) file with csv.reader
                                                     and prints its rows as JSON

Standard library only; content is deterministic.
"""

import csv
import json
import os
import random
import sys

TRICKY = [
    "plain",
    "",
    " leading and trailing ",
    "comma, inside",
    "semi; colon",
    "tab\tinside",
    "pipe | inside",
    'quote " inside',
    '""',
    '"starts with quote',
    "line\nfeed",
    "carriage\rreturn",
    "crlf\r\nboth",
    "=1+1",
    "-5",
    "@SUM(A1)",
    "café",
    "漢字",
    "emoji 😀",
    "trailing newline\n",
]


def table(seed, width, height):
    rnd = random.Random(seed)
    return [[rnd.choice(TRICKY) + rnd.choice(["", "x", "1"]) for _ in range(width)] for _ in range(height)]


DIALECTS = {
    # name: (writer kwargs, delimiter, encoding)
    "excel.csv": ({}, ",", "utf-8"),
    "excel-sig.csv": ({}, ",", "utf-8-sig"),
    "excel-tab.tsv": ({"dialect": "excel-tab"}, "\t", "utf-8"),
    "unix-all.csv": ({"dialect": "unix"}, ",", "utf-8"),
    "semicolon.csv": ({"delimiter": ";", "lineterminator": "\n"}, ";", "utf-8"),
    "pipe-nonnumeric.csv": ({"delimiter": "|", "quoting": csv.QUOTE_NONNUMERIC}, "|", "utf-8"),
}


def write(outdir):
    manifest = {}
    for i, (name, (kwargs, delimiter, encoding)) in enumerate(DIALECTS.items()):
        rows = [["id", "text", "more"]] + table(i + 1, 3, 40)
        with open(os.path.join(outdir, name), "w", newline="", encoding=encoding) as f:
            csv.writer(f, **kwargs).writerows(rows)
        manifest[name] = {"delimiter": delimiter, "encoding": encoding, "rows": rows}
    print(json.dumps(manifest))


def read(path, delimiter):
    with open(path, newline="", encoding="utf-8-sig") as f:
        print(json.dumps(list(csv.reader(f, delimiter=delimiter, strict=True))))


if __name__ == "__main__":
    if sys.argv[1] == "write":
        write(sys.argv[2])
    elif sys.argv[1] == "read":
        read(sys.argv[2], sys.argv[3])
    else:
        sys.exit("usage: csv_interop.py write <outdir> | read <file> <delimiter>")
