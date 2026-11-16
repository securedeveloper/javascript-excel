#!/usr/bin/env bash
# Generates the LibreOffice reader fixtures in this folder.
#
#   test/fixtures/read/generate_libreoffice.sh <outdir>
#
# Needs LibreOffice Calc (`soffice`, e.g. apt-get install libreoffice-calc-nogui)
# and python3 with openpyxl 3.1.5. LibreOffice opens each source workbook and
# saves it as .xlsx, so the output is written by LibreOffice's own xlsx
# filter. The output is committed; the tests never run this script.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$(mkdir -p "$1" && cd "$1" && pwd)"
src="$(mktemp -d)"
py="${JSE_PYTHON:-python3}"

# Sources: the openpyxl feature fixture, and a sheet of fill-down formulas.
cp "$here/openpyxl-features.xlsx" "$src/libreoffice-features.xlsx"
"$py" -I - "$src/libreoffice-filldown.xlsx" <<'PY'
import datetime as dt, sys
from openpyxl import Workbook
wb = Workbook()
ws = wb.active
ws.title = "Fill"
ws.append(["n", "double", "running", "date"])
for i in range(1, 51):
    r = i + 1
    ws.append([i, f"=A{r}*2", f"=SUM($A$2:A{r})", dt.date(2024, 1, i if i <= 31 else 31)])
    ws.cell(row=r, column=4).number_format = "yyyy-mm-dd"
ws.append(["=SUM(A2:A51)"])
ws.freeze_panes = "A2"
wb.save(sys.argv[1])
PY

for f in "$src"/*.xlsx; do
  soffice --headless --norestore --convert-to "xlsx:Calc MS Excel 2007 XML" --outdir "$out" "$f" >/dev/null
done
soffice --version | head -1 > "$out/libreoffice-version.txt"
rm -rf "$src"
ls -l "$out"
