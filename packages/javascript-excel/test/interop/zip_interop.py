"""Zip interop helper for test/zip-interop.test.ts.

  python3 zip_interop.py write <outdir>   writes reference archives with Python's zipfile
                                          and prints a JSON manifest of their entries
  python3 zip_interop.py read <zipfile>   reads an archive and prints its entries as JSON

Standard library only. Content is deterministic so the TypeScript side can
compare SHA-256 digests.
"""

import hashlib
import io
import json
import os
import random
import sys
import zipfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def contents():
    rnd = random.Random(1)
    row = b'<row><c t="s"><v>0</v></c><c><v>3.14</v></c></row>'
    return [
        ("[Content_Types].xml", b'<?xml version="1.0"?><Types/>', zipfile.ZIP_DEFLATED),
        ("xl/worksheets/sheet1.xml", b"<sheetData>" + row * 20000 + b"</sheetData>", zipfile.ZIP_DEFLATED),
        ("bin/random.bin", rnd.randbytes(200_000), zipfile.ZIP_DEFLATED),
        ("stored.txt", b"stored, not compressed\n" * 10, zipfile.ZIP_STORED),
        ("empty.txt", b"", zipfile.ZIP_DEFLATED),
        ("données/ü.xml", "<v>été 漢字</v>".encode(), zipfile.ZIP_DEFLATED),
    ]


class Unseekable(io.RawIOBase):
    """A write-only stream without seek/tell, which makes zipfile use data descriptors."""

    def __init__(self):
        self.buf = bytearray()

    def writable(self):
        return True

    def write(self, b):
        self.buf += b
        return len(b)


def write(outdir):
    manifest = {}
    entries = contents()

    path = os.path.join(outdir, "py-basic.zip")
    with zipfile.ZipFile(path, "w") as zf:
        for name, data, method in entries:
            zf.writestr(zipfile.ZipInfo(name, (2024, 1, 15, 10, 30, 0)), data, compress_type=method)
        zf.writestr(zipfile.ZipInfo("dir/", (2024, 1, 15, 10, 30, 0)), b"")
        zf.comment = b"archive comment"
    manifest["py-basic.zip"] = {n: digest(d) for n, d, _ in entries} | {"dir/": digest(b"")}

    stream = Unseekable()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, data, method in entries:
            if method == zipfile.ZIP_DEFLATED:
                zf.writestr(name, data)
    with open(os.path.join(outdir, "py-descriptor.zip"), "wb") as f:
        f.write(stream.buf)
    manifest["py-descriptor.zip"] = {n: digest(d) for n, d, m in entries if m == zipfile.ZIP_DEFLATED}

    path = os.path.join(outdir, "py-zip64.zip")
    big = entries[1][1]
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        with zf.open("big.xml", "w", force_zip64=True) as w:
            w.write(big)
        zf.writestr("small.txt", b"after a zip64 entry")
    manifest["py-zip64.zip"] = {"big.xml": digest(big), "small.txt": digest(b"after a zip64 entry")}

    print(json.dumps(manifest))


def read(path):
    with zipfile.ZipFile(path) as zf:
        bad = zf.testzip()
        out = {
            "testzip": bad,
            "entries": [
                {
                    "name": i.filename,
                    "sha256": digest(zf.read(i)),
                    "method": i.compress_type,
                    "flags": i.flag_bits,
                    "date_time": list(i.date_time),
                }
                for i in zf.infolist()
            ],
        }
    print(json.dumps(out))


if __name__ == "__main__":
    cmd, arg = sys.argv[1], sys.argv[2]
    write(arg) if cmd == "write" else read(arg)
