"""Generates the openpyxl reader fixtures in this folder.

  python3 generate_openpyxl.py

Needs openpyxl (tested with 3.1.5): pip install openpyxl==3.1.5. The output is
committed; the tests never run this script. Rerun it only to change a fixture,
and update test/read/fixtures.test.ts to match.
"""

import datetime as dt
import os

from openpyxl import Workbook
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont
from openpyxl.styles import Alignment, Border, Font, PatternFill, Protection, Side
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.hyperlink import Hyperlink

HERE = os.path.dirname(os.path.abspath(__file__))
FIXED = dt.datetime(2024, 1, 15, 10, 30, 0)


def props(wb):
    wb.properties.title = "Fixture"
    wb.properties.creator = "fixture-generator"
    wb.properties.created = FIXED
    wb.properties.modified = FIXED


def features():
    wb = Workbook()
    props(wb)
    ws = wb.active
    ws.title = "Values"
    ws["A1"] = "text"
    ws["B1"] = 42
    ws["C1"] = 3.5
    ws["D1"] = True
    ws["E1"] = dt.date(2024, 1, 15)
    ws["F1"] = dt.datetime(2024, 1, 15, 10, 30, 0)
    ws["G1"] = "=B1*2"
    ws["H1"] = "#N/A"
    ws["H1"].data_type = "e"
    ws["A2"] = "  leading and trailing  "
    ws["B2"] = -0.25
    ws["C2"] = "line1\nline2"
    ws["D2"] = "café 漢字 😀"
    ws["E2"] = "_x0041_ literal"
    ws["A3"] = CellRichText(["plain ", TextBlock(InlineFont(b=True, color="FFFF0000"), "bold red"), " end"])
    ws["A4"] = "=SUM(B1:C1)"
    ws["E1"].number_format = "yyyy-mm-dd"
    ws["F1"].number_format = "yyyy-mm-dd hh:mm:ss"
    ws["B3"] = 0.5
    ws["B3"].number_format = "0.00%"
    ws["C3"] = 1234.5
    ws["C3"].number_format = "#,##0.00"
    ws["D3"] = 1.5
    ws["D3"].number_format = "[h]:mm:ss"

    st = wb.create_sheet("Styles")
    st["A1"] = "styled"
    st["A1"].font = Font(name="Arial", size=14, bold=True, italic=True, underline="double", strike=True, color="FF336699")
    st["A1"].fill = PatternFill(fill_type="solid", fgColor="FFFFFF00")
    st["A1"].border = Border(left=Side(style="thin", color="FF000000"), bottom=Side(style="double", color="FFFF0000"))
    st["A1"].alignment = Alignment(horizontal="center", vertical="top", wrap_text=True, text_rotation=45, indent=0)
    st["A1"].protection = Protection(locked=False)
    st["B1"] = "same style"
    st["B1"]._style = st["A1"]._style
    st["A2"] = "theme"
    st["A2"].font = Font(color=None)
    st["A2"].fill = PatternFill(fill_type="darkGrid", fgColor="FF00FF00", bgColor="FF0000FF")
    st["A3"] = "indent"
    st["A3"].alignment = Alignment(horizontal="left", indent=2, text_rotation=135)
    st.merge_cells("C1:D2")
    st["C1"] = "merged"
    st.column_dimensions["A"].width = 30
    st.column_dimensions["C"].hidden = True
    st.row_dimensions[2].height = 40
    st.freeze_panes = "B2"
    st.sheet_properties.tabColor = "FF00B050"
    st.sheet_view.zoomScale = 150
    st.auto_filter.ref = "A1:B3"
    st["A5"] = "link"
    st["A5"].hyperlink = "https://example.com/path?q=1"
    st["B5"] = "internal"
    st["B5"].hyperlink = Hyperlink(ref="B5", location="'Values'!A1", tooltip="go")
    st.print_options.gridLines = True
    st.page_setup.orientation = "landscape"
    st.page_setup.paperSize = 9
    st.sheet_properties.pageSetUpPr.fitToPage = True
    st.page_setup.fitToWidth = 1
    st.page_setup.fitToHeight = 0
    st.page_margins.left = 0.5
    st.oddHeader.center.text = "Page &P"
    st.print_title_rows = "1:1"
    st.print_area = "A1:D10"

    hid = wb.create_sheet("Hidden")
    hid.sheet_state = "hidden"
    hid["A1"] = 1
    wb.defined_names["TaxRate"] = DefinedName("TaxRate", attr_text="Values!$B$1")
    wb.active = 1
    wb.save(os.path.join(HERE, "openpyxl-features.xlsx"))


def date1904():
    wb = Workbook()
    props(wb)
    wb.epoch = dt.datetime(1904, 1, 1)  # CALENDAR_MAC_1904
    ws = wb.active
    ws.title = "Mac"
    ws["A1"] = dt.date(2024, 1, 15)
    ws["A1"].number_format = "yyyy-mm-dd"
    ws["A2"] = 0
    ws["A2"].number_format = "yyyy-mm-dd"
    wb.save(os.path.join(HERE, "openpyxl-1904.xlsx"))


if __name__ == "__main__":
    features()
    date1904()
    print("ok")
