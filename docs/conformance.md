# Conformance check

<!-- Generated from packages/javascript-excel/test/conformance/corpus.ts by `npm run conformance:doc`. Do not edit by hand. -->

This checklist is for a one-time manual check of the conformance corpus in **Microsoft Excel (Windows and Mac)** and **Apple Numbers**. The automated checks already open every file in LibreOffice and read it back with openpyxl and with javascript-excel's own reader. Only a person with Excel and Numbers can confirm what those apps show.

## Getting the files

- **From CI:** open the latest run of the `CI` workflow on `main` (or on a pull request), find the `LibreOffice` job, and download the **`conformance-corpus`** artifact. It contains every file below, this checklist (`CHECKLIST.md`) and `manifest.json` with each file's SHA-256.
- **Locally:** `npm run conformance:artifact -w packages/javascript-excel` writes `packages/javascript-excel/conformance-corpus/` and `conformance-corpus.zip`.

Every sheet is self-describing. Column A says what a row tests, column B holds the sample, and column C says what you should see. Open each file in Excel for Windows, Excel for Mac and Numbers.

## How to record results

For each file and app, note **pass**, or describe the difference (a screenshot helps). Report:

- any **repair prompt** ("We found a problem with some content…"), which always counts as a failure;
- every row in [Open items](#open-items-this-check-resolves) below; those results update `docs/api.md`.

Numbers does not support every Excel feature (for example pattern fills, outline groups or print titles), so a missing feature in Numbers is a note, not a failure. A file that does not open, or a wrong value or date, is a failure in every app.

## Files

| File | Covers |
|---|---|
| `01-values.xlsx` | Cell values: strings, numbers, booleans, error values, empty styled cells, shared and inline strings |
| `02-text.xlsx` | Text edge cases and rich text: ST_Xstring escapes (CR, control characters, literal _xHHHH_), line breaks, 32,767-character text, rich-text runs, inline strings |
| `03-dates.xlsx` | Dates (1900 date system): Date cells, default date format, times, the 1900 leap-year quirk, time-only values, the date range |
| `04-dates-1904.xlsx` | Dates (1904 date system): workbookPr/@date1904 |
| `05-formulas.xlsx` | Formulas and cached values: formulas with cached number/string/boolean/error/date results, array formulas, fullCalcOnLoad for formulas without a cached value |
| `06-fonts.xlsx` | Fonts: every font property and all four colour forms |
| `07-fills.xlsx` | Fills: all 18 non-empty pattern types, the solid shorthand, linear and path gradients |
| `08-borders.xlsx` | Borders: all 13 visible border styles, a colour per side, diagonals |
| `09-alignment.xlsx` | Alignment and protection: horizontal and vertical alignment, rotation, vertical text, indent (including the 250 maximum), reading order, wrap, shrink, protection flags |
| `10-number-formats.xlsx` | Built-in and custom number formats: every built-in id the spec defines (0–4, 9–22, 37–40, 45–49) and custom codes |
| `11-number-formats-locale.xlsx` | Locale-dependent built-in number formats: built-in ids the spec does not list: 5–8, 23–36, 41–44, 50–58 |
| `12-colours.xlsx` | Colours: theme order, tints, indexed palette: theme indices 0–11, tints, indexed colours 0–65 (including 64/65), automatic colour, ARGB alpha |
| `13-columns-rows.xlsx` | Column widths, row heights, hidden and outline: widths in characters, {wch}, {wpx}, 'auto', width 0; row heights; hidden rows and columns; outline levels; column and row styles; default sizes |
| `14-merges-views.xlsx` | Merges, freeze panes, views and tab colours: merged ranges, frozen rows/columns/both, right-to-left, zoom, gridlines and headings off, selection, tab colours, hidden and very hidden sheets, the active sheet |
| `15-hyperlinks-names.xlsx` | Hyperlinks and defined names: external, mailto and internal hyperlinks with tooltips; workbook and sheet-scoped defined names |
| `16-print.xlsx` | Print setup: orientation, paper size, fit to width, margins, centring, gridlines, headings, print area, print titles, headers and footers |
| `17-workbook.xlsx` | Workbook properties, default font and sheet names: document properties (core, app, custom), a non-default workbook font, sheet names at the 31-character limit, quoting in references |
| `18-limits.xlsx` | Format limits: the last cell (XFD1048576), 32,767-character text, 64,000 distinct cell formats *(large file)* |
| `99-kitchen-sink.xlsx` | Kitchen sink: every sheet of every non-heavy corpus file in one workbook, with all defined names and properties |

### 01-values.xlsx: Cell values

Covers strings, numbers, booleans, error values, empty styled cells, shared and inline strings.

| Where | Look at | Expected | Excel Win | Excel Mac | Numbers |
|---|---|---|---|---|---|
| Values!B2:B21 | Compare column B with column C, row by row. | Every sample matches its description; no repair prompt when opening. | | | |
| Values!B4 | Select the cell and look at the formula bar. | The formula bar shows =1+1 as text (the cell is not a formula). | | | |

### 02-text.xlsx: Text edge cases and rich text

Covers ST_Xstring escapes (CR, control characters, literal _xHHHH_), line breaks, 32,767-character text, rich-text runs, inline strings.

| Where | Look at | Expected | Excel Win | Excel Mac | Numbers |
|---|---|---|---|---|---|
| Text!B2:B12 | Compare column B with column C. Strings in this file are inline strings (sharedStrings: false). | Every sample matches; no _x000D_ or _x0001_ text appears anywhere. | | | |
| Text!B10 | Check the formula result. | 32767. | | | |

### 03-dates.xlsx: Dates (1900 date system)

Covers Date cells, default date format, times, the 1900 leap-year quirk, time-only values, the date range.

| Where | Look at | Expected | Excel Win | Excel Mac | Numbers |
|---|---|---|---|---|---|
| Dates!B2:B11 | Compare column B with column C. | All dates and times match. 1900-01-01 and 1900-02-28 show exactly those dates (Excel's 1900 system). | | | |

### 04-dates-1904.xlsx: Dates (1904 date system)

Covers workbookPr/@date1904.

| Where | Look at | Expected | Excel Win | Excel Mac | Numbers |
|---|---|---|---|---|---|
| Dates 1904!B2:B4 | Compare column B with column C. | Dates match. | | | |
| File > Options > Advanced (Excel for Mac: Preferences > Calculation) | Look at 'Use 1904 date system'. | It is ticked for this workbook. | | | |

### 05-formulas.xlsx: Formulas and cached values

Covers formulas with cached number/string/boolean/error/date results, array formulas, fullCalcOnLoad for formulas without a cached value.

| Where | Look at | Expected | Excel Win | Excel Mac | Numbers |
|---|---|---|---|---|---|
| Formulas!B2:B10 | Compare column B with column C; select cells to see each formula in the formula bar. | Results match. B6 shows 20 after Excel recalculated it. B7 shows {=D2:D4*10} as an array formula. | | | |
| Close the workbook | Close it without changes. | Excel may ask to save (it recalculated); that is expected for generated files. | | | |

### 06-fonts.xlsx: Fonts

Covers every font property and all four colour forms.

| Where | Look at | Expected | Excel Win | Excel Mac | Numbers |
|---|---|---|---|---|---|
| Fonts!B2:B18 | Compare column B with column C; use Format Cells > Font for details. | Every font matches its description. | | | |

### 07-fills.xlsx: Fills

Covers all 18 non-empty pattern types, the solid shorthand, linear and path gradients.

| Where | Look at | Expected | Excel Win | Excel Mac | Numbers |
|---|---|---|---|---|---|
| Fills!B2:B22 | Compare each cell with Format Cells > Fill; the pattern name is in column A. | Every pattern style matches its name, red on yellow. Gradients as described. | | | |

### 08-borders.xlsx: Borders

Covers all 13 visible border styles, a colour per side, diagonals.

| Where | Look at | Expected | Excel Win | Excel Mac | Numbers |
|---|---|---|---|---|---|
| Borders!B2:B16 | Compare with Format Cells > Border; the style name is in column A and in the cell. | Each style matches its name (thin, medium, thick, double, hair, dotted, dashed, dash-dot, dash-dot-dot, medium dashed, medium dash-dot, medium dash-dot-dot, slanted dash-dot). | | | |

### 09-alignment.xlsx: Alignment and protection

Covers horizontal and vertical alignment, rotation, vertical text, indent (including the 250 maximum), reading order, wrap, shrink, protection flags.

| Where | Look at | Expected | Excel Win | Excel Mac | Numbers |
|---|---|---|---|---|---|
| Alignment!B2:B26 | Compare with Format Cells > Alignment and Protection. | Everything matches column C. | | | |
| Alignment!B20 | Open Format Cells > Alignment and try to set Indent to 251. | Excel shows 250 for this cell and refuses 251. **(open item)** | | | |

### 10-number-formats.xlsx: Built-in and custom number formats

Covers every built-in id the spec defines (0–4, 9–22, 37–40, 45–49) and custom codes.

| Where | Look at | Expected | Excel Win | Excel Mac | Numbers |
|---|---|---|---|---|---|
| Built-in!C2:C29 | For each row, open Format Cells > Number > Custom and read the selected code. | The code matches column B (ids 14 and 22 may show your locale's date format). Write down the exact code Excel shows for ids 37, 38, 39, 40 and 47, including spaces. **(open item)** | | | |
| Custom!B2:B7 | Compare column B with column C. | Everything matches. | | | |

### 11-number-formats-locale.xlsx: Locale-dependent built-in number formats

Covers built-in ids the spec does not list: 5–8, 23–36, 41–44, 50–58.

| Where | Look at | Expected | Excel Win | Excel Mac | Numbers |
|---|---|---|---|---|---|
| Locale ids!B2:C32 | Note what each row shows, in your Excel locale. If you can, switch Excel or Windows to Japanese or Chinese and look again at ids 27–36 and 50–58. | No repair prompt. In an East Asian locale, ids 27–36 and 50–58 show dates; elsewhere they may show General. Record the result for each id. **(open item)** | | | |

### 12-colours.xlsx: Colours: theme order, tints, indexed palette

Covers theme indices 0–11, tints, indexed colours 0–65 (including 64/65), automatic colour, ARGB alpha.

| Where | Look at | Expected | Excel Win | Excel Mac | Numbers |
|---|---|---|---|---|---|
| Theme!B2:B13 | Select each fill and open Fill Color > Theme Colors; note which swatch is highlighted. | Row 0 is Background 1 (white), 1 is Text 1 (black), 2 is Background 2, 3 is Text 2, 4–9 are Accent 1–6, 10 Hyperlink, 11 Followed Hyperlink. Columns D and E are lighter and darker versions. **(open item)** | | | |
| Indexed!C66:C67 | Look at the text colour of 'Aa' for indexed 64 and 65. | 64 is black (system foreground), 65 is white (system background). **(open item)** | | | |

### 13-columns-rows.xlsx: Column widths, row heights, hidden and outline

Covers widths in characters, {wch}, {wpx}, 'auto', width 0; row heights; hidden rows and columns; outline levels; column and row styles; default sizes.

| Where | Look at | Expected | Excel Win | Excel Mac | Numbers |
|---|---|---|---|---|---|
| Widths!A:F | Hover over the right edge of each column header (or Format > Column Width) and note the width Excel shows. | A 8.43 (64 px), B 10 (75 px), C 20 (145 px), D 12 (89 px), E 8.43 (64 px), F 13.57 (100 px). On a Mac the pixel values may differ; the character widths must match. **(open item)** | | | |
| Widths!G:J | Look at columns G to J. | G is wide enough for its text; H and I are hidden (no header visible); J has the default width. | | | |
| Widths!rows 3–9, columns K:L | Look at the rows and the outline buttons. | Row 3 is tall (30 pt), row 5 is hidden, rows 7–8 and columns K–L have outline (group) buttons, row 9 is green across the whole row, columns K–L are light orange. | | | |

### 14-merges-views.xlsx: Merges, freeze panes, views and tab colours

Covers merged ranges, frozen rows/columns/both, right-to-left, zoom, gridlines and headings off, selection, tab colours, hidden and very hidden sheets, the active sheet.

| Where | Look at | Expected | Excel Win | Excel Mac | Numbers |
|---|---|---|---|---|---|
| Opening the file | Look at which sheet is shown. | 'Frozen both (active)' is active, with C5 selected. | | | |
| Merges!A1:C4 | Look at the merged cells. | A1:C1, A2:A4 and B3:C4 are merged; the Merges tab is red, the active sheet's tab is blue. | | | |
| Frozen both (active), Frozen rows | Scroll down and right. | Row 1 and column A stay put on the first; rows 1–2 stay put on the second. | | | |
| RTL zoom 150 | Look at the sheet. | Column A is on the right, zoom 150%, no gridlines, no row/column headings. | | | |
| Sheet tabs (right-click > Unhide) | List the hidden sheets. | 'Hidden' can be unhidden; 'Very hidden' is not listed. | | | |

### 15-hyperlinks-names.xlsx: Hyperlinks and defined names

Covers external, mailto and internal hyperlinks with tooltips; workbook and sheet-scoped defined names.

| Where | Look at | Expected | Excel Win | Excel Mac | Numbers |
|---|---|---|---|---|---|
| Links & names!B2:B6 | Hover and Ctrl/Cmd-click each link. | Each link does what column C says. | | | |
| Formulas > Name Manager | List the names. | TaxRate (Workbook scope, refers to B8) and LocalTotal (scope: Second sheet, comment 'scoped to Second sheet'). | | | |

### 16-print.xlsx: Print setup

Covers orientation, paper size, fit to width, margins, centring, gridlines, headings, print area, print titles, headers and footers.

| Where | Look at | Expected | Excel Win | Excel Mac | Numbers |
|---|---|---|---|---|---|
| Print!File > Print (preview) and Page Layout > Page Setup | Look at the preview and the Page Setup dialog. | Landscape, A4, Fit to 1 page wide by automatic tall, margins 0.5/0.5/1/1 in (header/footer 0.4), centred horizontally, gridlines and row/column headings printed, print area A1:N80, row 1 and column A repeat on every page. Header: 'Conformance' left, 'Print setup' centre, the date right. Footer 'Page n of m'; the first page has 'First page' instead. | | | |

### 17-workbook.xlsx: Workbook properties, default font and sheet names

Covers document properties (core, app, custom), a non-default workbook font, sheet names at the 31-character limit, quoting in references.

| Where | Look at | Expected | Excel Win | Excel Mac | Numbers |
|---|---|---|---|---|---|
| File > Info > Properties (Advanced Properties > Summary and Custom) | Read the properties. | Title 'Conformance: workbook', subject, author 'Conformance corpus', keywords, comments, category, company 'Example Co', manager. Custom: Project, Build 42, Ratio 0.25, Released No, Checked on 2026-11-16. | | | |
| Properties!A1 | Look at the font. | Arial 10; Home > Cell Styles > Normal is Arial 10. | | | |
| Any sheet tab | Rename a sheet to History. Then rename one to 31 characters made of 30 x's and one emoji (😀). | Record whether Excel refuses 'History' and whether it accepts the 31-character emoji name (if it does, Excel counts characters, not UTF-16 code units). **(open item)** | | | |

### 18-limits.xlsx: Format limits

Covers the last cell (XFD1048576), 32,767-character text, 64,000 distinct cell formats.

| Where | Look at | Expected | Excel Win | Excel Mac | Numbers |
|---|---|---|---|---|---|
| Opening the file | Open it and wait (it is large). | No repair prompt. Ctrl/Cmd+End jumps to XFD1048576. The writer emits 64,000 cell formats (the default one plus 63,999), the most it allows; Excel's documented limit is 64,000. **(open item)** | | | |

### 99-kitchen-sink.xlsx: Kitchen sink

Covers every sheet of every non-heavy corpus file in one workbook, with all defined names and properties.

| Where | Look at | Expected | Excel Win | Excel Mac | Numbers |
|---|---|---|---|---|---|
| Every sheet | Page through every sheet and repeat the checks of the individual files where you like. | No repair prompt; every sheet looks as in its own file. | | | |

## Open items this check resolves

These facts are marked `[to verify]` in `docs/api.md`. Each one is checked by the file named here; record the result, and the doc is updated from it.

| Open item | File | Where |
|---|---|---|
| indent maximum 250 (§3.5.4) | `09-alignment.xlsx` | Alignment!B20 |
| codes and spacing of built-in formats 37–40 and 47 (§11.2) | `10-number-formats.xlsx` | Built-in!C2:C29 |
| ids 27–36 and 50–58 are date formats (§3.4.1) | `11-number-formats-locale.xlsx` | Locale ids!B2:C32 |
| theme index order: 0 = lt1, 1 = dk1, 2 = lt2, 3 = dk2 (§3.5.6) | `12-colours.xlsx` | Theme!B2:B13 |
| indexed 64 = system foreground, 65 = system background (§3.5.6) | `12-colours.xlsx` | Indexed!C66:C67 |
| maximum digit width 7 px for Calibri 11 (§3.3) | `13-columns-rows.xlsx` | Widths!A:F |
| 'History' is reserved; how the 31-character limit counts astral characters (§3.3) | `17-workbook.xlsx` | Any sheet tab |
| 64,000 unique cell formats (§7.2, §11.1) | `18-limits.xlsx` | Opening the file |
| how newer Excel errors such as `#SPILL!` are stored (§3.4) | *(make one)* | In Excel 365, enter `=SEQUENCE(3)` in A2 and any value in A3 so it spills into a blocked cell, save as `.xlsx`, and attach the file to the report. The XML is inspected from it. |

Not covered by a manual check: date detection for custom formats (§3.4.1) is checked automatically by the reader tests, and the maximum digit width for default fonts other than Calibri 11 stays open.
