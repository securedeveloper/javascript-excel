"""Generates the measurement corpus for the reader's default limits (not committed).

  python3 generate_corpus.py <outdir>

Needs openpyxl 3.1.5. Each file is shaped to stress one limit with
legitimate content: dense and repetitive sheets, one repeated shared string,
styled empty cells, many sheets, long text. measure_limits.mjs then reports
entry counts, sizes, compression ratios and XML depth for every file.
"""

import os
import random
import sys

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill


def save(wb, outdir, name):
    path = os.path.join(outdir, name)
    wb.save(path)
    print(name, os.path.getsize(path))


def main(outdir):
    os.makedirs(outdir, exist_ok=True)
    rnd = random.Random(1)

    wb = Workbook(write_only=True)
    ws = wb.create_sheet("dense")
    for _ in range(200_000):
        ws.append([rnd.random() * 1e6 for _ in range(10)])
    save(wb, outdir, "dense-2M-cells.xlsx")

    wb = Workbook(write_only=True)
    ws = wb.create_sheet("same-number")
    for _ in range(100_000):
        ws.append([1] * 10)
    save(wb, outdir, "repetitive-number-1M-cells.xlsx")

    wb = Workbook(write_only=True)
    ws = wb.create_sheet("same-string")
    for _ in range(100_000):
        ws.append(["Status: OK"] * 10)
    save(wb, outdir, "repetitive-string-1M-cells.xlsx")

    wb = Workbook()
    ws = wb.active
    bold = Font(bold=True)
    fill = PatternFill(fill_type="solid", fgColor="FFFFFF00")
    for r in range(1, 50_001):
        for c in range(1, 11):
            cell = ws.cell(row=r, column=c)
            cell.font = bold
            cell.fill = fill
    save(wb, outdir, "styled-empty-500k-cells.xlsx")

    wb = Workbook(write_only=True)
    for i in range(250):
        ws = wb.create_sheet(f"S{i}")
        ws.append([i, f"sheet {i}"])
    save(wb, outdir, "many-sheets-250.xlsx")

    wb = Workbook(write_only=True)
    ws = wb.create_sheet("text")
    words = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]
    for i in range(20_000):
        ws.append([" ".join(rnd.choice(words) for _ in range(200)), i])
    save(wb, outdir, "long-text-20k.xlsx")

    wb = Workbook(write_only=True)
    ws = wb.create_sheet("unique")
    for i in range(300_000):
        ws.append([f"id-{i:07d}", f"name {rnd.randrange(10**9)}"])
    save(wb, outdir, "unique-strings-600k.xlsx")


if __name__ == "__main__":
    main(sys.argv[1])
