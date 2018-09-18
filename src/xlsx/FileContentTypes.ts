import {___JSE_XLSX___File, ___JSE_XLSX___FileContent, ___JSE_XLSX___Node} from "../api/xlsx";
import {
    Extension_Rels,
    Extension_Xml, PartName_DocProps_App, PartName_DocProps_Core, PartName_DocProps_Custom, PartName_Xl_SharedStrings,
    PartName_Xl_Sheet, PartName_Xl_Styles,
    PartName_Xl_Theme,
    PartName_Xl_Workbook,
    Xmlns_Types
} from "../api/Internals";
import {JSESheet, JSExcel} from "../Types";

const fileProps: any = {
    name: "[Content_Types]",
    extension: ".xml",
    version: "1.0",
    encoding: "UTF-8",
    standalone: true,
    nodes: {
        Types: "Types",
        Default: "Default",
        Override: "Override"
    },
    keys: {
        xmlns: "xmlns",
        Extension: "Extension",
        ContentType: "ContentType",
        PartName: "PartName"
    },
    values: {
        rels: "rels",
        xml: "xml",
        PartName_xml: "/xl/workbook.xml"
    }
};

export default (excel: JSExcel): ___JSE_XLSX___File => ({
    fileName: fileProps.name,
    fileExtension: fileProps.extension,
    fileContent: getContentTypeNodes(excel)
});

function getContentTypeNodes(excel: JSExcel): ___JSE_XLSX___FileContent {
    return {
        xml: {
            version: fileProps.version,
            encoding: fileProps.encoding,
            standalone: fileProps.standalone
        },
        content: {
            name: fileProps.nodes.Types,
            values: [{key: fileProps.keys.xmlns, value: Xmlns_Types}],
            content: [
                {
                    name: fileProps.nodes.Default,
                    values:
                        [
                            {key: fileProps.keys.Extension, value: fileProps.values.rels},
                            {key: fileProps.keys.ContentType, value: Extension_Rels}
                        ]
                },
                {
                    name: fileProps.nodes.Default,
                    values:
                        [
                            {key: fileProps.keys.Extension, value: fileProps.values.xml},
                            {key: fileProps.keys.ContentType, value: Extension_Xml}
                        ]
                },
                //xl folder contents
                {
                    //workbook
                    name: fileProps.nodes.Override,
                    values:
                        [
                            {key: fileProps.keys.PartName, value: fileProps.values.PartName_xml},
                            {key: fileProps.keys.ContentType, value: PartName_Xl_Workbook}
                        ]
                },
                ...getWorkSheetsOverrides(excel),
                ...getThemesOverrides(excel),
                ...getStylesOverrides(excel),
                ...getSharedStringsOverrides(excel),
                ...getPropsOverrides(excel),
            ]
        }
    }
}

function getWorkSheetsOverrides(excel: JSExcel): Array<___JSE_XLSX___Node> {
    const partNameOverride: string = "/xl/worksheets/";

    return excel.sheets.map((sheet: JSESheet) => ({
        name: fileProps.nodes.Override,
        values: [
            {key: fileProps.keys.PartName, value: `${partNameOverride}${sheet.name}${fileProps.extension}`},
            {key: fileProps.keys.ContentType, value: PartName_Xl_Sheet}
        ]
    }));
}

function getThemesOverrides(excel: JSExcel): Array<___JSE_XLSX___Node> {
    const partNameOverride: string = "/xl/theme/";

    // TODO: Complete Overrides
    return [{
        name: fileProps.nodes.Override,
        values: [
            {key: fileProps.keys.PartName, value: `${partNameOverride}theme1${fileProps.extension}`},
            {key: fileProps.keys.ContentType, value: PartName_Xl_Theme}
        ]
    }];
}

function getStylesOverrides(excel: JSExcel): Array<___JSE_XLSX___Node> {
    const partNameOverride: string = "/xl/styles";

    // TODO: Complete Overrides
    return [{
        name: fileProps.nodes.Override,
        values: [
            {key: fileProps.keys.PartName, value: `${partNameOverride}${fileProps.extension}`},
            {key: fileProps.keys.ContentType, value: PartName_Xl_Styles}
        ]
    }];
}

function getSharedStringsOverrides(excel: JSExcel): Array<___JSE_XLSX___Node> {
    const partNameOverride: string = "/xl/sharedStrings";

    // TODO: Complete Overrides
    return [{
        name: fileProps.nodes.Override,
        values: [
            {key: fileProps.keys.PartName, value: `${partNameOverride}${fileProps.extension}`},
            {key: fileProps.keys.ContentType, value: PartName_Xl_SharedStrings}
        ]
    }];
}

function getPropsOverrides(excel: JSExcel): Array<___JSE_XLSX___Node> {
    const partNameOverride: string = "/docProps/";

    return [
        {
            name: fileProps.nodes.Override,
            values: [
                {key: fileProps.keys.PartName, value: `${partNameOverride}core${fileProps.extension}`},
                {key: fileProps.keys.ContentType, value: PartName_DocProps_Core}
            ]
        },
        {
            name: fileProps.nodes.Override,
            values: [
                {key: fileProps.keys.PartName, value: `${partNameOverride}app${fileProps.extension}`},
                {key: fileProps.keys.ContentType, value: PartName_DocProps_App}
            ]
        },
        // ...getCustomPropsOverrider(excel) TODO: Implement when doc props interface is available and only custom props are provided
    ];
}

function getCustomPropsOverrider(excel: JSExcel): ___JSE_XLSX___Node {
    // if(!excel.props.customProps) return; TODO: finish it

    const partNameOverride: string = "/docProps/custom";

    return {
        name: fileProps.nodes.Override,
        values: [
            {key: fileProps.keys.PartName, value: `${partNameOverride}${fileProps.extension}`},
            {key: fileProps.keys.ContentType, value: PartName_DocProps_Custom}
        ]
    };
}