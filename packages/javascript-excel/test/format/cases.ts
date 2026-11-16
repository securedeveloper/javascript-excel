// The number-format reference corpus: format codes and the values each is
// shown with. test/format/libreoffice.test.ts writes them to a workbook, has
// LibreOffice export it "as shown" and compares every cell with formatValue.
// The cells of the conformance corpus's number-format files (10 and 11) are
// added there too.

import type { NumFmt } from "../../src/model";

const NUMBERS = [1234.5678, -1234.5678, 0, 0.5, -0.5, 1e-5, 123456789.123, 7];
const SMALL = [0.256, -0.03125, 0, 1.5, 12.5];
const DATES = [1, 59, 60, 61, 45306, 45306.6458333, 45306.99999999, 2958465, 0.5];
const TIMES = [0, 0.25, 0.5, 0.6458333, 0.999999, 1.5215278, 0.0215278, 2.75];

export interface FormatCase {
  code: NumFmt;
  values: Array<number | string | boolean>;
}

export const FORMAT_CASES: FormatCase[] = [
  // General and plain numbers
  { code: "General", values: [1234.5678, 0.1 + 0.2, 42, -3.5, 1 / 3, -1 / 3, 1e21, 1e-7, 123456789012, 12345678901, 0.0001, 0.00001, 1e15 + 0.5, 99999999999.5, -0.000123456789] },
  { code: "0", values: [...NUMBERS, 2.5, -2.5, 1e20] },
  { code: "0.00", values: [...NUMBERS, 1.005, -0.001, 0.125] },
  { code: "0.000", values: NUMBERS },
  { code: "#,##0", values: NUMBERS },
  { code: "#,##0.00", values: NUMBERS },
  { code: "#,##0.###", values: NUMBERS },
  { code: "#.##", values: [0.5, 1, 12.345, 0] },
  { code: "0.##", values: [1, 1.5, 1.555] },
  { code: "0.0?", values: [1.5, 1.25, 1] },
  { code: "??0.0", values: [1.5, 123.25] },
  { code: "00000", values: [42, 123456] },
  { code: "000-00-0000", values: [123456789] },
  { code: "#,##0,", values: [1234567, 999] },
  { code: "0.0,,", values: [1234567, 98765432] },
  { code: "#,##0.00,,\"M\"", values: [1234567890] },
  // Percent and scientific
  { code: "0%", values: SMALL },
  { code: "0.00%", values: SMALL },
  { code: "0.00E+00", values: [...NUMBERS, 0.000123] },
  { code: "0.0E+0", values: [99999, 0.00051] },
  { code: "##0.0E+0", values: [12345.678, 0.000123, 1234567] },
  { code: "0.00e-00", values: [12345, 0.00012] },
  // Fractions
  { code: "# ?/?", values: [1.25, 0.5, 2, 0, -1.75, 3.14159] },
  { code: "# ??/??", values: [1.3125, 3.14159, 0.1] },
  { code: "# ???/???", values: [3.14159] },
  { code: "?/?", values: [0.75, 1.5] },
  { code: "# ?/8", values: [1.3, 0.5] },
  { code: "# ??/16", values: [2.6] },
  // Sections, conditions, colours and literals
  { code: "0;(0)", values: [5, -5, 0] },
  { code: "0;-0;\"zero\"", values: [5, -5, 0] },
  { code: '0.0;-0.0;"zero";"text: "@', values: [5, -5, 0, "abc"] },
  { code: "[Blue]0.0;[Red]-0.0;0", values: [12.5, -12.5, 0] },
  { code: '[>100]"big";[<0]"neg";"small"', values: [150, -1, 5] },
  { code: "[<1000]0;[>=1000]#,##0", values: [999, 12345] },
  { code: "[Red][<=100]0;[Blue][>100]0", values: [50, 150] },
  { code: '#,##0.00 "€"', values: [1234.5, -1234.5] },
  { code: '"Total: "General', values: [12.5, -3] },
  { code: "\\$#,##0.00", values: [1234.5] },
  { code: "_(0_)", values: [5, -5] },
  { code: "[$€-407]#,##0.00", values: [1234.5] },
  { code: "[$$-409]#,##0.00", values: [1234.5] },
  { code: ";;;", values: [5, -5, 0, "x"] },
  // Text
  { code: "@", values: [1234.5, "abc"] },
  { code: '"<"@">"', values: ["abc", 5] },
  // Dates
  { code: "yyyy-mm-dd", values: DATES },
  { code: "yyyy-mm-dd hh:mm:ss", values: DATES },
  { code: "d-mmm-yy", values: DATES },
  { code: "dd/mm/yyyy", values: DATES },
  { code: "m/d/yy", values: DATES },
  { code: "dddd, mmmm d, yyyy", values: [45306, 61, 1] },
  { code: "ddd d mmm yy", values: [45306] },
  { code: "mmmmm", values: [45306, 45337] },
  { code: "yy", values: [45306] },
  { code: 'yyyy-mm-dd"T"hh:mm', values: [45306.37847222] },
  // Times and elapsed time
  { code: "h:mm", values: TIMES },
  { code: "h:mm:ss", values: TIMES },
  { code: "hh:mm:ss.000", values: [0.5000014236] },
  { code: "ss.00", values: [1.5 / 86400] },
  { code: "h:mm AM/PM", values: TIMES },
  { code: "h am/pm", values: [0.5, 0.1] },
  { code: "h:mm A/P", values: [0.75] },
  { code: "mm:ss", values: [0.0215278, 0.5] },
  { code: "[h]:mm", values: [1.5, 0.5, 30.25] },
  { code: "[h]:mm:ss", values: [1.5215278] },
  { code: "[mm]:ss", values: [0.0215278, 1] },
  { code: "[ss]", values: [0.0215278] },
  // Built-in ids (en-US)
  ...[1, 2, 3, 4, 9, 10, 11, 12, 13, 37, 38, 39, 40, 48, 49].map((id) => ({ code: id, values: [1234.5678, -1234.5678, 0.256] })),
  ...[14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47].map((id) => ({ code: id, values: [45306.6458333, 0.0215278] })),
];
