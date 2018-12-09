import { DEFAULT_FONT_SIZE, DEFAULT_FONT_NAME, DEFAULT_FONT_COLOR } from "../../api/constants";
import { DEFAULT_STAND_ALONE, DEFAULT_XML_VERSION, ENCODING_UTF_8, EXTENSION_XML, FILE_STYLES } from "../../api/Internals";
import { ___JSE_XLSX___File, ___JSE_XLSX___Node } from "../../api/xlsx";
import { JSEFont, JSExcel, JSEColor, JSECellBorder, JSEBorderType } from "../../Types";
import { extractFontsFromExcel, hasFontsInExcel, hasBordersInExcel, extractBordersFromExcel } from "../../util/ExcelUtil";

const fileProps: any = {
    xml: {
        version: DEFAULT_XML_VERSION,
        encoding: ENCODING_UTF_8,
        standalone: DEFAULT_STAND_ALONE
    },
    name: FILE_STYLES,
    extension: EXTENSION_XML,
    nodes: {
        styleSheet: "styleSheet",
        fonts: "fonts",
        font: "font",
        sz: "sz",
        color: "color",
        name: "name",
        b: "b",
        i: "i",
        u: "u",
        family: "family",
        fills: "fills",
        fill: "fill",
        patternFill: "patternFill",
        fgColor: "fgColor",
        bgColor: "bgColor",
        borders: "borders",
        border: "border",
        left: "left",
        right: "right",
        top: "top",
        bottom: "bottom",
        diagonal: "diagonal",
        cellStyleXfs: "cellStyleXfs",
        xf: "xf",
        alignment: "alignment",
        cellStyles: "cellStyles",
        cellStyle: "cellStyle",
        dxfs: "dxfs",
        tableStyles: "tableStyles",
        extLst: "extLst",
        ext: "ext"
    },
    keys: {
        val: "val",
        rgb: "rgb",
        theme: "theme",
        tint: "tint",
        count: "count",
        patternType: "patternType",
        indexed: "indexed",
        style: "style",
        numFmtId: "numFmtId",
        fontId: "fontId",
        fillId: "fillId",
        borderId: "borderId",
        xfId: "xfId",
        applyFont: "applyFont",
        applyFill: "applyFill",
        applyBorder: "applyBorder",
        applyAlignment: "applyAlignment",
        horizontal: "horizontal",
        vertical: "vertical",
        name: "name",
        builtinId: "builtinId",
        defaultTableStyle: "defaultTableStyle",
        uri: "uri",
        xmlnsX14: "xmlns:x14",
        xmlnsX15: "xmlns:x15",
        defaultSlicerStyle: "defaultSlicerStyle",
        defaultTimelineStyle: "defaultTimelineStyle"
    },
};

export default (excel: JSExcel): ___JSE_XLSX___File => ({
    fileName: fileProps.name,
    fileExtension: fileProps.extension,
    fileContent: {
        xml: { ...fileProps.xml },
        content: {
            name: fileProps.nodes.styleSheet,
            values: [
                //TODO: Fill out nodes
            ],
            content: [
                getFontsNodes(excel),
                //getFillsNodes(excel),
                getBorderNodes(excel),
                getCellStyleXfsNodes(excel),
                getCellXfsNodes(excel),
                getCellStylesNodes(excel),
                getDXFSNodes(excel),
                getTableStylesNodes(excel),
                getExtLstNodes(excel)
            ]
        }
    }
});

function getFontsNodes(excel: JSExcel): ___JSE_XLSX___Node | undefined {
    if (hasFontsInExcel(excel)) {
        return {
            name: fileProps.nodes.fonts,
            content: extractFonts(excel)
        };
    }
}

function extractFonts(excel: JSExcel): Array<___JSE_XLSX___Node> {
    return extractFontsFromExcel(excel).map(getFontNode);
}

function getFontNode(font: JSEFont): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.font,
        content: [
            getFontProperty_Bold(font),
            getFontProperty_Italic(font),
            getFontProperty_Underline(font),
            getFontProperty_Size(font),
            getFontProperty_Color(font),
            getFontProperty_Name(font),
            getFontProperty_Family(font)
        ]
    };
}

function getFontProperty_Bold(font: JSEFont): ___JSE_XLSX___Node | undefined {
    if (!font.bold) {
        return;
    }

    return {
        name: fileProps.nodes.b
    };
}

function getFontProperty_Italic(font: JSEFont): ___JSE_XLSX___Node | undefined {
    if (!font.italic) {
        return;
    }

    return {
        name: fileProps.nodes.i
    };
}

function getFontProperty_Underline(font: JSEFont): ___JSE_XLSX___Node | undefined {
    if (!font.underline) {
        return;
    }

    return {
        name: fileProps.nodes.u
    };
}

function getFontProperty_Size(font: JSEFont): ___JSE_XLSX___Node {
    const fontSize: number = !font.size ? DEFAULT_FONT_SIZE : font.size;

    return {
        name: fileProps.nodes.sz,
        values: [{ key: fileProps.keys.val, value: fontSize }]
    };
}

function getFontProperty_Color(font: JSEFont): ___JSE_XLSX___Node {
    let fontColor: string;
    let theme: any;
    let tint: any;

    if (!font.color) {
        fontColor = DEFAULT_FONT_COLOR;
    }

    if (typeof font.color === "string") {
        fontColor = font.color;
    } else {
        const colour: JSEColor = font.color as JSEColor;
        fontColor = !colour.rgb ? DEFAULT_FONT_COLOR : colour.rgb;

        if (colour.theme) {
            theme = { key: fileProps.keys.theme, value: colour.theme };
        }

        if (colour.tint) {
            tint = { key: fileProps.keys.tint, value: colour.tint };
        }
    }

    return {
        name: fileProps.nodes.color,
        values: [
            { key: fileProps.keys.rgb, value: fontColor },
            ...theme,
            ...tint
        ]
    };
}

function getFontProperty_Name(font: JSEFont): ___JSE_XLSX___Node {
    const fontName: string = !font.name ? DEFAULT_FONT_NAME : font.name;

    return {
        name: fileProps.nodes.name,
        values: [{ key: fileProps.keys.val, value: fontName }]
    };
}

function getFontProperty_Family(font: JSEFont): ___JSE_XLSX___Node | undefined {
    if (!font.family) {
        return;
    }

    return {
        name: fileProps.nodes.family,
        values: [{ key: fileProps.keys.val, value: font.family }]
    };
}

/*function getFillsNodes(excel: JSExcel): ___JSE_XLSX___Node {
    if (hasFillsInExcel(excel)) {
        return {
            name: fileProps.nodes.fills,
            content: extractFills(excel)
        };
    }
}*/

function getBorderNodes(excel: JSExcel): ___JSE_XLSX___Node | undefined {
    if (hasBordersInExcel(excel)) {
        const borders: Array<JSECellBorder> = extractBordersFromExcel(excel);

        return {
            name: fileProps.node.borders,
            values: [{ key: fileProps.keys.count, value: borders.length }],
            content: borders.map(getBorderNode)
        };
    }
}

function getBorderNode(border: JSECellBorder): ___JSE_XLSX___Node | undefined {
    return {
        name: fileProps.node.border,
        content: [
            getLeftCellBorder(border),
            getRightCellBorder(border),
            getTopCellBorder(border),
            getBottomCellBorder(border),
            getDiagonalCellBorder(border),
        ]
    };
}

function getLeftCellBorder(border: JSECellBorder): ___JSE_XLSX___Node | undefined {
    if (!border.left) {
        return;
    }

    const style: JSEBorderType = border.left.type || "thin";
    let colorIndex: any;

    if (border.left.color) {
        colorIndex = {
            content: [{
                name: fileProps.node.color,
                values: [
                    { key: fileProps.keys.indexed, value: border.left.color }
                ]
            }]
        };
    }

    return {
        name: fileProps.node.left,
        values: [
            { key: fileProps.keys.style, value: style }
        ],
        ...colorIndex
    };
}

function getRightCellBorder(border: JSECellBorder): ___JSE_XLSX___Node | undefined {
    if (!border.right) {
        return;
    }

    const style: JSEBorderType = border.right.type || "thin";
    let colorIndex: any;

    if (border.right.color) {
        colorIndex = {
            content: [{
                name: fileProps.node.color,
                values: [
                    { key: fileProps.keys.indexed, value: border.right.color }
                ]
            }]
        };
    }

    return {
        name: fileProps.node.right,
        values: [
            { key: fileProps.keys.style, value: style }
        ],
        ...colorIndex
    };
}

function getTopCellBorder(border: JSECellBorder): ___JSE_XLSX___Node | undefined {
    if (!border.top) {
        return;
    }

    const style: JSEBorderType = border.top.type || "thin";
    let colorIndex: any;

    if (border.top.color) {
        colorIndex = {
            content: [{
                name: fileProps.node.color,
                values: [
                    { key: fileProps.keys.indexed, value: border.top.color }
                ]
            }]
        };
    }

    return {
        name: fileProps.node.top,
        values: [
            { key: fileProps.keys.style, value: style }
        ],
        ...colorIndex
    };
}

function getBottomCellBorder(border: JSECellBorder): ___JSE_XLSX___Node | undefined {
    if (!border.bottom) {
        return;
    }

    const style: JSEBorderType = border.bottom.type || "thin";
    let colorIndex: any;

    if (border.bottom.color) {
        colorIndex = {
            content: [{
                name: fileProps.node.color,
                values: [
                    { key: fileProps.keys.indexed, value: border.bottom.color }
                ]
            }]
        };
    }

    return {
        name: fileProps.node.bottom,
        values: [
            { key: fileProps.keys.style, value: style }
        ],
        ...colorIndex
    };
}

function getDiagonalCellBorder(border: JSECellBorder): ___JSE_XLSX___Node | undefined {
    if (!border.diagonal) {
        return;
    }

    const style: JSEBorderType = border.diagonal.type || "thin";
    let colorIndex: any;

    if (border.diagonal.color) {
        colorIndex = {
            content: [{
                name: fileProps.node.color,
                values: [
                    { key: fileProps.keys.indexed, value: border.diagonal.color }
                ]
            }]
        };
    }

    return {
        name: fileProps.node.diagonal,
        values: [
            { key: fileProps.keys.style, value: style }
        ],
        ...colorIndex
    };
}

function getCellStyleXfsNodes(excel: JSExcel): ___JSE_XLSX___Node {

}

function getCellXfsNodes(excel: JSExcel): ___JSE_XLSX___Node {

}

function getCellStylesNodes(excel: JSExcel): ___JSE_XLSX___Node {

}

function getDXFSNodes(excel: JSExcel): ___JSE_XLSX___Node {

}

function getTableStylesNodes(excel: JSExcel): ___JSE_XLSX___Node {

}

function getExtLstNodes(excel: JSExcel): ___JSE_XLSX___Node {

}
