/** A1 reference for a zero-based row and column, e.g. (2, 1) -> 'B3'. */
export function cellRef(row: number, col: number): string {
  let name = "";
  let n = col + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return `${name}${row + 1}`;
}
