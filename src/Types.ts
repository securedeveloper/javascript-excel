// TODO: Write down the documentation for reach of the following interfaces and types

interface JSETextStyle {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
}

export interface JSEColor {
    rgb?: string; // in hex format without hash
    theme?: string;
    tint?: string;
}

export interface JSEFont extends JSETextStyle {
    name: string; // default Calibri
    size: number; //default 11
    color: JSEColor | string //simple hex value;
    family?: string;
}

/**
 * JSEFill interface
 * @param patternType
 * @child {fgColor, bgColor}
 */

export type JSEFillPattern = "none" | "gray125" | "solid";

export interface JSEFill {
    pattern?: JSEFillPattern;
    //childElements?: Array<NodeList>;
}

/**
 * JSECellBorder interface
 */

export type JSEBorderType = "thin"; //TODO: complete the list

export interface JSEBorder {
    type?: JSEBorderType;
    color?: JSEColor; // TODO: find a better way
}

export interface JSECellBorder {
    left?: JSEBorder;
    right?: JSEBorder;
    top?: JSEBorder;
    bottom?: JSEBorder;
    diagonal?: JSEBorder;
}

export interface JSECellStyle {
    font?: JSEFont; //else get default color
    //fill?: JSEFill; #Complete Lately
    border?: JSECellBorder;
}

export type JSEContentType = string | number | boolean;

export interface JSECell extends JSECellStyle {
    content?: JSEContentType;
}

export interface JSEHeaderCell extends JSECell {

}

export type JSERow = Array<JSECell>;
export type JSEData = Array<JSERow>;

export interface JSESheet {
    name: string;
    columns?: Array<JSEHeaderCell>;
    data: JSEData;
}

export interface JSExcel {
    sheets: Array<JSESheet>;
    // props: JSEDocumentProps; TODO: create interface for document props
}