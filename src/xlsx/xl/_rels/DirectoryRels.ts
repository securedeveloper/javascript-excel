import {
    XMLNS_RELATIONSHIPS,
    EXTENSION_RELS,
    DEFAULT_XML_VERSION,
    ENCODING_UTF_8,
    DEFAULT_STAND_ALONE, FILE_RELS
} from "../../../api/Internals";
import {EXTENSION_XML, FILE_WORKBOOK} from "../../../api/Internals";
import {JSESheet, JSExcel} from "../../../Types";
import {
    ___JSE_XLSX___Directory,
    ___JSE_XLSX___File,
    ___JSE_XLSX___FileContent,
    ___JSE_XLSX___Node
} from "../../../api/xlsx";

const fileProps: any = {
    name: `${FILE_WORKBOOK}${EXTENSION_XML}`,
    extension: EXTENSION_RELS,
    version: DEFAULT_XML_VERSION,
    encoding: ENCODING_UTF_8,
    standalone: DEFAULT_STAND_ALONE,
    nodes: {
        Relationships: "Relationships",
        Relationship: "Relationship"
    },
    keys: {
        xmlns: "xmlns",
        Id: "Id",
        Type: "Type",
        Target: "Target"
    }
};

const directorProps: any = {
    name: FILE_RELS,
    files: {workBookXMLRels: {...fileProps}}
};

export default (excel: JSExcel): ___JSE_XLSX___Directory => ({
    directoryName: directorProps.name,
    content: getRelDirectoryFiles(excel)
});

function getRelDirectoryFiles(excel: JSExcel): ___JSE_XLSX___File {
    return {
        fileName: fileProps.name,
        fileExtension: fileProps.extension,
        fileContent: getRelsNodes(excel)
    };
}

function getRelsNodes(excel: JSExcel): ___JSE_XLSX___FileContent {
    return {
        xml: {
            version: fileProps.version,
            encoding: fileProps.encoding,
            standalone: fileProps.standalone
        },
        content: {
            name: fileProps.nodes.Relationships,
            values: [{key: fileProps.keys.xmlns, value: XMLNS_RELATIONSHIPS}],
            content: [
                ...excel.sheets.map((sheet: JSESheet, index: number): ___JSE_XLSX___Node => {
                    return {
                        name: fileProps.nodes.Relationship,
                        values: [
                            {key: fileProps.keys.Id, value: `rId${index + 1}`},
                            {
                                key: fileProps.keys.Type,
                                value: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
                            },
                            {key: fileProps.keys.Target, value: `worksheets/sheet${index + 1}.xml`}
                        ]
                    };
                }),
                {
                    name: fileProps.nodes.Relationship,
                    values: [
                        {key: fileProps.keys.Id, value: `rId${excel.sheets.length + 1}`},
                        {
                            key: fileProps.keys.Type,
                            value: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"
                        },
                        {key: fileProps.keys.Target, value: "theme/theme1.xml"}
                    ]
                },
                {
                    name: fileProps.nodes.Relationship,
                    values: [
                        {key: fileProps.keys.Id, value: `rId${excel.sheets.length + 2}`},
                        {
                            key: fileProps.keys.Type,
                            value: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings"
                        },
                        {key: fileProps.keys.Target, value: "sharedStrings.xml"}
                    ]
                },
                {
                    name: fileProps.nodes.Relationship,
                    values: [
                        {key: fileProps.keys.Id, value: `rId${excel.sheets.length + 3}`},
                        {
                            key: fileProps.keys.Type,
                            value: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
                        },
                        {key: fileProps.keys.Target, value: "styles.xml"}
                    ]
                }
            ]
        }
    };
}
