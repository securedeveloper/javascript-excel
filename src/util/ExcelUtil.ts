import { JSECell, JSEFont, JSEHeaderCell, JSERow, JSESheet, JSExcel, JSEBorder, JSECellBorder } from "../Types";

export function excelTotalCellCounter(excel: JSExcel): number {
    if (excel == null || excel == undefined || excel.sheets == undefined) return 0;

    return excel.sheets.map(sheetTotalCellCounter).reduce(add, 0);
}

function sheetTotalCellCounter(sheet: JSESheet): number {
    if (sheet == null || sheet == undefined) return 0;
    const { columns, data } = sheet;

    return columns ? columns.length + data.map(rowTotalCellCounter).reduce(add, 0) : data.map(rowTotalCellCounter).reduce(add, 0);
}

function rowTotalCellCounter(row: JSERow) {
    if (row == null || row == undefined) return 0;

    return row.length;
}

function add(item1: number, item2: number) {
    return item1 + item2;
}

/**
 * Fonts utility/helper functions
 */

export function hasFontsInExcel(excel: JSExcel): boolean {
    if (excel == null || excel == undefined) return false;

    return excel.sheets.some(hasFontInSheet);
}

function hasFontInSheet(sheet: JSESheet): boolean {
    if (sheet == null || sheet == undefined) return false;

    return (sheet.columns && sheet.columns.some(hasFontInCell)) || sheet.data.some(row => row.some(hasFontInCell));
}

function hasFontInCell(cell: JSECell): boolean {
    if (cell == null || cell == undefined) return false;

    return !!(cell.font && cell.font.name);
}

export function extractFontsFromExcel(excel: JSExcel): Array<JSEFont> {
    if (excel == null || excel == undefined) return [];

    return excel.sheets.flatMap(getFontsFromSheet);
}

function getFontsFromSheet(sheet: JSESheet): Array<JSEFont> {
    const fonts: Array<JSEFont> = [];

    if (sheet.columns) {
        sheet.columns.map((col: JSEHeaderCell) => {
            if (col.font) {
                fonts.push(col.font);
            }
        });
    }

    if (sheet.data) {
        sheet.data.forEach((row: JSERow) => {
            row.forEach((col: JSECell) => {
                if (col.font) {
                    fonts.push(col.font);
                }
            });
        });
    }

    return fonts;
}

/**
 *  Fills utility/helper functions
 *  */

/*
export function hasFillsInExcel(excel: JSExcel): boolean {
    if (excel == null || excel == undefined) return false;

    return excel.sheets.some(hasFillsInSheet);
}

function hasFillsInSheet(sheet: JSESheet): boolean {
    if (sheet == null || sheet == undefined) return false;

    return (sheet.columns && sheet.columns.some(hasFillsInCell)) || sheet.data.some(row => row.some(hasFillsInCell));
}

function hasFillsInCell(cell: JSECell): boolean {
    if (cell == null || cell == undefined) return false;

    return !!(cell.fill && cell.fille.patternFill);
}

export function extractFillsFromExcel(excel: JSExcel): Array<JSEFill> {
    if (excel == null || excel == undefined) return [];

    return excel.sheets.flatMap(extractFillsFromSheet);
}

function extractFillsFromSheet(sheet: JSESheet): Array<JSEFill> {
    const fills: Array<JSEFill> = [];

    if (sheet.columns) {
        sheet.columns.map((col: JSEHeaderCell) => {
            if (col.font) {
                fills.push(col.fill);
            }
        });
    }

    if (sheet.data) {
        sheet.data.forEach((row: JSERow) => {
            row.forEach((col: JSECell) => {
                if (col.fill) {
                    fills.push(col.fill);
                }
            });
        });
    }

    return fills;
}
*/

export function hasBordersInExcel(excel: JSExcel): boolean {
    if (excel == null || excel == undefined) return false;

    return excel.sheets.some(hasBordersInSheet);
}

function hasBordersInSheet(sheet: JSESheet): boolean {
    if (sheet == null || sheet == undefined) return false;

    return (sheet.columns && sheet.columns.some(hasBordersInCell)) || sheet.data.some(row => row.some(hasBordersInCell));
}

function hasBordersInCell(cell: JSECell): boolean {
    if (cell == null || cell == undefined) return false;

    return !!(cell.font && cell.font.name);
}

export function extractBordersFromExcel(excel: JSExcel): Array<JSECellBorder> {
    if (excel == null || excel == undefined) return [];

    return excel.sheets.flatMap(getBordersFromSheet);
}

function getBordersFromSheet(sheet: JSESheet): Array<JSECellBorder> {
    const borders: Array<JSECellBorder> = [];

    if (sheet.columns) {
        sheet.columns.map((col: JSEHeaderCell) => {
            if (col.border) {
                borders.push(col.border);
            }
        });
    }

    if (sheet.data) {
        sheet.data.forEach((row: JSERow) => {
            row.forEach((col: JSECell) => {
                if (col.border) {
                    borders.push(col.border);
                }
            });
        });
    }

    return borders;
}