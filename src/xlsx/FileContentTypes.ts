import {___JSE_XLSX___File, ___JSE_XLSX___FileContent, ___JSE_XLSX___Node} from "../api/xlsx";
import {
    EXTENSION_RELS_SCHEMA,
    EXTENSION_XML_SCHEMA,
    PART_NAME_DOC_PROPS_APP,
    PART_NAME_DOC_PROPS_CORE,
    PART_NAME_DOC_PROPS_CUSTOM,
    PART_NAME_XL_SHARED_STRINGS,
    PART_NAME_XL_WORKSHEET,
    PART_NAME_XL_STYLES,
    PART_NAME_XL_THEME,
    PART_NAME_XL_WORKBOOK,
    XMLNS_CONTENT_TYPES,
    DEFAULT_XML_VERSION, ENCODING_UTF_8, DEFAULT_STAND_ALONE
} from "../api/Internals";
import {JSESheet, JSExcel} from "../Types";
import {DEFAULT_FILE_EXTENSION} from "../api/constants";

const fileProps: any = {
    name: "[Content_Types]",
    extension: DEFAULT_FILE_EXTENSION,
    version: DEFAULT_XML_VERSION,
    encoding: ENCODING_UTF_8,
    standalone: DEFAULT_STAND_ALONE,
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
            values: [{key: fileProps.keys.xmlns, value: XMLNS_CONTENT_TYPES}],
            content: [
                {
                    name: fileProps.nodes.Default,
                    values:
                        [
                            {key: fileProps.keys.Extension, value: fileProps.values.rels},
                            {key: fileProps.keys.ContentType, value: EXTENSION_RELS_SCHEMA}
                        ]
                },
                {
                    name: fileProps.nodes.Default,
                    values:
                        [
                            {key: fileProps.keys.Extension, value: fileProps.values.xml},
                            {key: fileProps.keys.ContentType, value: EXTENSION_XML_SCHEMA}
                        ]
                },
                //xl folder contents
                {
                    //workbook
                    name: fileProps.nodes.Override,
                    values:
                        [
                            {key: fileProps.keys.PartName, value: fileProps.values.PartName_xml},
                            {key: fileProps.keys.ContentType, value: PART_NAME_XL_WORKBOOK}
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
            {key: fileProps.keys.ContentType, value: PART_NAME_XL_WORKSHEET}
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
            {key: fileProps.keys.ContentType, value: PART_NAME_XL_THEME}
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
            {key: fileProps.keys.ContentType, value: PART_NAME_XL_STYLES}
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
            {key: fileProps.keys.ContentType, value: PART_NAME_XL_SHARED_STRINGS}
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
                {key: fileProps.keys.ContentType, value: PART_NAME_DOC_PROPS_CORE}
            ]
        },
        {
            name: fileProps.nodes.Override,
            values: [
                {key: fileProps.keys.PartName, value: `${partNameOverride}app${fileProps.extension}`},
                {key: fileProps.keys.ContentType, value: PART_NAME_DOC_PROPS_APP}
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
            {key: fileProps.keys.ContentType, value: PART_NAME_DOC_PROPS_CUSTOM}
        ]
    };
}