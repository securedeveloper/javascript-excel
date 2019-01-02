import {DEFAULT_FONT_SIZE, DEFAULT_FONT_NAME, DEFAULT_FONT_COLOR} from "../../api/constants";
import {
    DEFAULT_STAND_ALONE,
    DEFAULT_XML_VERSION,
    ENCODING_UTF_8,
    EXTENSION_XML,
    FILE_STYLES, XMLNS_MAIN, XMLNS_MC, XMLNS_X14AC, XMLNS_X16R2, XMLNS_XR
} from "../../api/Internals";
import {___JSE_XLSX___File, ___JSE_XLSX___Node} from "../../api/xlsx";
import {JSEFont, JSExcel, JSEColor, JSECellBorder, JSEBorderType} from "../../Types";
import {extractFontsFromExcel, hasFontsInExcel, hasBordersInExcel, extractBordersFromExcel} from "../../util/ExcelUtil";

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
        cellXfs: "cellXfs",
        xf: "xf",
        alignment: "alignment",
        cellStyles: "cellStyles",
        cellStyle: "cellStyle",
        dxfs: "dxfs",
        tableStyles: "tableStyles",
        extLst: "extLst",
        ext: "ext",
        x14SlicerStyles: "x14:slicerStyles",
        x15TimelineStyles: "x15:timelineStyles"
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
        defaultPivotStyle: "defaultPivotStyle",
        uri: "uri",
        xmlnsX14: "xmlns:x14",
        xmlnsX15: "xmlns:x15",
        xmlns: "xmlns",
        xmlnsMc: "xmlns:mc",
        mcIgnorable: "mc:Ignorable",
        xmlnsX14ac: "xmlns:x14ac",
        xmlnsX16r2: "xmlns:x16r2",
        xmlnsXr: "xmlns:xr",
        defaultSlicerStyle: "defaultSlicerStyle",
        defaultTimelineStyle: "defaultTimelineStyle"
    },
};

export default (excel: JSExcel): ___JSE_XLSX___File => ({
    fileName: fileProps.name,
    fileExtension: fileProps.extension,
    fileContent: {
        xml: {...fileProps.xml},
        content: {
            name: fileProps.nodes.styleSheet,
            values: [
                {key: fileProps.keys.xmlns, value: XMLNS_MAIN},
                {key: fileProps.keys.xmlnsMc, value: XMLNS_MC},
                {key: fileProps.keys.mcIgnorable, value: "x14ac x16r2 xr"}, //TODO: Double check
                {key: fileProps.keys.xmlnsX14ac, value: XMLNS_X14AC},
                {key: fileProps.keys.xmlnsX16r2, value: XMLNS_X16R2},
                {key: fileProps.keys.xmlnsXr, value: XMLNS_XR}
            ],
            content: [
                getFontsNodes(excel),
                // getFillsNodes(excel),
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
    const fontCalculatedNodes: Array<___JSE_XLSX___Node | undefined> = [
        getFontProperty_Bold(font),
        getFontProperty_Italic(font),
        getFontProperty_Underline(font),
        getFontProperty_Size(font),
        getFontProperty_Color(font),
        getFontProperty_Name(font),
        getFontProperty_Family(font)
    ];

    const fontNodes: Array<___JSE_XLSX___Node> = [];

    fontCalculatedNodes.forEach((item: ___JSE_XLSX___Node | undefined) => {
        if (item !== null || item !== undefined) {
            fontNodes.push(item as ___JSE_XLSX___Node);
        }
    });

    return {
        name: fileProps.nodes.font,
        content: fontNodes
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
        values: [{key: fileProps.keys.val, value: fontSize}]
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
            theme = {key: fileProps.keys.theme, value: colour.theme};
        }

        if (colour.tint) {
            tint = {key: fileProps.keys.tint, value: colour.tint};
        }
    }

    return {
        name: fileProps.nodes.color,
        values: [
            {key: fileProps.keys.rgb, value: fontColor},
            ...theme,
            ...tint
        ]
    };
}

function getFontProperty_Name(font: JSEFont): ___JSE_XLSX___Node {
    const fontName: string = !font.name ? DEFAULT_FONT_NAME : font.name;

    return {
        name: fileProps.nodes.name,
        values: [{key: fileProps.keys.val, value: fontName}]
    };
}

function getFontProperty_Family(font: JSEFont): ___JSE_XLSX___Node | undefined {
    if (!font.family) {
        return;
    }

    return {
        name: fileProps.nodes.family,
        values: [{key: fileProps.keys.val, value: font.family}]
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
            name: fileProps.nodes.borders,
            values: [{key: fileProps.keys.count, value: borders.length}],
            content: borders.map(getBorderNode)
        };
    }
}

function getBorderNode(border: JSECellBorder): ___JSE_XLSX___Node | undefined {
    return {
        name: fileProps.nodes.border,
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
                name: fileProps.nodes.color,
                values: [
                    {key: fileProps.keys.indexed, value: border.left.color}
                ]
            }]
        };
    }

    return {
        name: fileProps.nodes.left,
        values: [
            {key: fileProps.keys.style, value: style}
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
                name: fileProps.nodes.color,
                values: [
                    {key: fileProps.keys.indexed, value: border.right.color}
                ]
            }]
        };
    }

    return {
        name: fileProps.nodes.right,
        values: [
            {key: fileProps.keys.style, value: style}
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
                name: fileProps.nodes.color,
                values: [
                    {key: fileProps.keys.indexed, value: border.top.color}
                ]
            }]
        };
    }

    return {
        name: fileProps.nodes.top,
        values: [
            {key: fileProps.keys.style, value: style}
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
                name: fileProps.nodes.color,
                values: [
                    {key: fileProps.keys.indexed, value: border.bottom.color}
                ]
            }]
        };
    }

    return {
        name: fileProps.nodes.bottom,
        values: [
            {key: fileProps.keys.style, value: style}
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
                name: fileProps.nodes.color,
                values: [
                    {key: fileProps.keys.indexed, value: border.diagonal.color}
                ]
            }]
        };
    }

    return {
        name: fileProps.nodes.diagonal,
        values: [
            {key: fileProps.keys.style, value: style}
        ],
        ...colorIndex
    };
}

function getCellStyleXfsNodes(excel: JSExcel): ___JSE_XLSX___Node {
    // TODO: complete as with excel sheet -CODE02
    return {
        name: fileProps.nodes.cellStyleXfs,
        values: [
            {key: fileProps.keys.count, value: "1"}
        ],
        content: {
            name: fileProps.nodes.xf,
            values: [
                {key: fileProps.keys.numFmtId, value: "0"},
                {key: fileProps.keys.fontId, value: "0"},
                {key: fileProps.keys.fillId, value: "0"},
                {key: fileProps.keys.borderId, value: "0"}
            ]
        }
    };
}

function getCellXfsNodes(excel: JSExcel): ___JSE_XLSX___Node {
    // TODO: complete as with excel sheet -CODE02
    return {
        name: fileProps.nodes.cellXfs,
        values: [
            {key: fileProps.keys.count, value: "1"}
        ],
        content: {
            name: fileProps.nodes.xf,
            values: [
                {key: fileProps.keys.numFmtId, value: "0"},
                {key: fileProps.keys.fontId, value: "0"},
                {key: fileProps.keys.fillId, value: "0"},
                {key: fileProps.keys.borderId, value: "0"},
                {key: fileProps.keys.xfId, value: "0"}
            ]
        }
    };
}

function getCellStylesNodes(excel: JSExcel): ___JSE_XLSX___Node {
    // TODO: complete as with excel sheet -CODE02
    return {
        name: fileProps.nodes.cellStyles,
        values: [
            {key: fileProps.keys.count, value: "1"}
        ],
        content: {
            name: fileProps.nodes.cellStyle,
            values: [
                {key: fileProps.keys.name, value: "Standard"},
                {key: fileProps.keys.xfId, value: "0"},
                {key: fileProps.keys.builtinId, value: "0"}
            ]
        }
    };
}

function getDXFSNodes(excel: JSExcel): ___JSE_XLSX___Node {
    // TODO: complete as with excel sheet -CODE02
    return {
        name: fileProps.nodes.dxfs,
        values: [
            {key: fileProps.keys.count, value: "0"}
        ]
    };
}

function getTableStylesNodes(excel: JSExcel): ___JSE_XLSX___Node {
    // TODO: complete as with excel sheet -CODE02
    return {
        name: fileProps.nodes.tableStyles,
        values: [
            {key: fileProps.keys.count, value: "0"},
            {key: fileProps.keys.defaultTableStyle, value: "TableStyleMedium2"},
            {key: fileProps.keys.defaultPivotStyle, value: "PivotStyleMedium9"}
        ]
    };
}

function getExtLstNodes(excel: JSExcel): ___JSE_XLSX___Node {
    // TODO: complete as with excel sheet -CODE02
    return {
        name: fileProps.nodes.extLst,
        content: [
            {
                name: fileProps.nodes.ext,
                values: [
                    {key: fileProps.keys.uri, value: "{EB79DEF2-80B8-43e5-95BD-54CBDDF9020C}"},
                    {
                        key: fileProps.keys.xmlnsX14,
                        value: "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
                    }
                ],
                content: {
                    name: fileProps.nodes.x14SlicerStyles,
                    values: [
                        {key: fileProps.keys.defaultSlicerStyle, value: "SlicerStyleLight1"}
                    ]
                }
            },
            {
                name: fileProps.nodes.ext,
                values: [
                    {key: fileProps.keys.uri, value: "{9260A510-F301-46a8-8635-F512D64BE5F5}"},
                    {
                        key: fileProps.keys.xmlnsX14,
                        value: "http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"
                    }
                ],
                content: {
                    name: fileProps.nodes.x15TimelineStyles,
                    values: [
                        {key: fileProps.keys.defaultTimelineStyle, value: "SlicerStyleLight1"}
                    ]
                }
            }
        ]
    };
}
