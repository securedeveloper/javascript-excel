import {JSESheet, JSExcel} from "../../Types";
import {___JSE_XLSX___File, ___JSE_XLSX___Node} from "../../api/xlsx";
import {
    DEFAULT_STAND_ALONE,
    DEFAULT_XML_VERSION,
    ENCODING_UTF_8,
    EXTENSION_XML,
    FILE_WORKBOOK,
    XMLNS_MAIN,
    XMLNS_MC,
    XMLNS_OFFICE_DOCUMENT_RELATIONSHIPS,
    XMLNS_XR
} from "../../api/Internals";

const fileProps: any = {
    xml: {
        version: DEFAULT_XML_VERSION,
        encoding: ENCODING_UTF_8,
        standalone: DEFAULT_STAND_ALONE
    },
    name: FILE_WORKBOOK,
    extension: EXTENSION_XML,
    nodes: {
        workbook: "workbook",
        fileVersion: "fileVersion",
        workbookPr: "workbookPr",
        xrRevisionPtr: "xr:revisionPtr",
        bookViews: "bookViews",
        workbookView: "workbookView",
        sheets: "sheets",
        sheet: "sheet",
        calcPr: "calcPr",
        extLst: "extLst",
        ext: "ext",
        xcalcfCalcFeatures: "xcalcf:calcFeatures",
        xcalcfFeature: "xcalcf:feature"
    },
    keys: {
        xmlns: "xmlns",
        xmlnsR: "xmlns:r",
        xmlnsMC: "xmlns:mc",
        xmlnsX15: "xmlns:x15",
        xmlnsXR: "xmlns:xr",
        xmlnsXR6: "xmlns:xr6",
        xmlnsXR10: "xmlns:xr10",
        xmlnsXR2: "xmlns:xr2",
        mcIgnorable: "mc:Ignorable",
        appName: "appName",
        lastEdited: "lastEdited",
        lowestEdited: "lowestEdited",
        rupBuild: "rupBuild",
        defaultThemeVersion: "defaultThemeVersion",
        revIDLastSave: "revIDLastSave",
        documentId: "documentId",
        xr6CoauthVersionLast: "xr6:coauthVersionLast",
        xr6CoauthVersionMax: "xr6:coauthVersionMax",
        xr10UidLastSave: "xr10:uidLastSave",
        xWindow: "xWindow",
        yWindow: "yWindow",
        windowWidth: "windowWidth",
        windowHeight: "windowHeight",
        activeTab: "activeTab",
        xr2Uid: "xr2:uid",
        name: "name",
        sheetId: "sheetId",
        rId: "r:id",
        calcId: "calcId",
        uri: "uri",
        xmlnsXcalcf: "xmlns:xcalcf"
    }
};

export default (excel: JSExcel): ___JSE_XLSX___File => ({
    fileName: fileProps.name,
    fileExtension: fileProps.extension,
    fileContent: {
        xml: {...fileProps.xml},
        content: {
            name: fileProps.nodes.workbook,
            values: [
                {key: fileProps.keys.xmlns, value: XMLNS_MAIN},
                {key: fileProps.keys.xmlnsR, value: XMLNS_OFFICE_DOCUMENT_RELATIONSHIPS},
                {key: fileProps.keys.xmlnsMC, value: XMLNS_MC},
                {key: fileProps.keys.mcIgnorable, value: "x15 xr xr6 xr10 xr2"},
                {key: fileProps.keys.xmlnsX15, value: "http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"},
                {key: fileProps.keys.xmlnsXR, value: XMLNS_XR},
                {
                    key: fileProps.keys.xmlnsXR6,
                    value: "http://schemas.microsoft.com/office/spreadsheetml/2016/revision6"
                },
                {
                    key: fileProps.keys.xmlnsXR10,
                    value: "http://schemas.microsoft.com/office/spreadsheetml/2016/revision10"
                },
                {
                    key: fileProps.keys.xmlnsXR2,
                    value: "http://schemas.microsoft.com/office/spreadsheetml/2015/revision2"
                },
            ],
            content: getWorkbookContents(excel)
        }
    }
});

function getWorkbookContents(excel: JSExcel): Array<___JSE_XLSX___Node> {
    return [
        getFileVersionNode(excel),
        getWorkbookPrNode(excel),
        getXRRevisionPtrNode(excel),
        getBookViewsNode(excel),
        getSheetsNode(excel),
        getCalcPrNode(excel),
        getExtLstNode(excel)
    ];
}

function getFileVersionNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.fileVersion,
        values: [
            {key: fileProps.keys.appName, value: "xl"},
            {key: fileProps.keys.lastEdited, value: "7"}, // TODO: verify again
            {key: fileProps.keys.lowestEdited, value: "4"},
            {key: fileProps.keys.rupBuild, value: "21230"}
        ]
    };
}

function getWorkbookPrNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.workbookPr,
        values: [
            {key: fileProps.keys.defaultThemeVersion, value: "166925"} //TODO: Verify value and create a constant
        ]
    };
}

function getXRRevisionPtrNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.xrRevisionPtr,
        values: [
            {key: fileProps.keys.revIDLastSave, value: "0"},
            {key: fileProps.keys.documentId, value: "8_{73AD8C06-8AEC-4845-8D70-B34A27716D4F}"},
            {key: fileProps.keys.xr6CoauthVersionLast, value: "40"},
            {key: fileProps.keys.xr6CoauthVersionMax, value: "40"},
            {key: fileProps.keys.xr10UidLastSave, value: "{00000000-0000-0000-0000-000000000000}"}
        ]
    };
}

function getBookViewsNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.bookViews,
        content: [
            {
                name: fileProps.nodes.workbookView,
                values: [
                    {key: fileProps.keys.xWindow, value: "240"},
                    {key: fileProps.keys.yWindow, value: "105"},
                    {key: fileProps.keys.windowWidth, value: "14805"},
                    {key: fileProps.keys.windowHeight, value: "8010"},
                    {key: fileProps.keys.activeTab, value: "1"},
                    {key: fileProps.keys.activeTab, value: "1"},
                    {key: fileProps.keys.xr2Uid, value: "{00000000-000D-0000-FFFF-FFFF00000000}"}
                ]
            }
        ]
    };
}

function getSheetsNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.sheets,
        content: excel.sheets.map(getSheetNode)
    };
}

function getSheetNode(sheet: JSESheet, index: number): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.sheet,
        values: [
            {key: fileProps.keys.name, value: sheet.name},
            {key: fileProps.keys.id, value: `${index + 1}`},
            {key: fileProps.keys.rId, value: `rId${index + 1}`}
        ]
    };
}

function getCalcPrNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.calcPr,
        values: [
            {key: fileProps.keys.calcId, value: "191028"}
        ]
    };
}

function getExtLstNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.extLst,
        content: {
            name: fileProps.nodes.ext,
            values: [
                {key: fileProps.keys.uri, value: "{B58B0392-4F1F-4190-BB64-5DF3571DCE5F}"},
                {
                    key: fileProps.keys.xmlnsXcalcf,
                    value: "http://schemas.microsoft.com/office/spreadsheetml/2018/calcfeatures"
                }
            ],
            content: {
                name: fileProps.nodes.xcalcfCalcFeatures,
                content: {
                    name: fileProps.nodes.xcalcfFeature,
                    values: [
                        {key: fileProps.keys.name, value: "microsoft.com:RD"}
                    ]
                }
            }
        }
    };
}
