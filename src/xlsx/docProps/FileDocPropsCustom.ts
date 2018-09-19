// TODO: Tier-02 Replace values when file properties module is implemented
import {JSExcel} from "../../Types";
import {___JSE_XLSX___File} from "../../api/xlsx";
import {
    DEFAULT_STAND_ALONE,
    DEFAULT_XML_VERSION,
    ENCODING_UTF_8,
    EXTENSION_XML,
    FILE_CUSTOM, XMLNS_CUSTOM_PROPERTIES, XMLNS_DOC_PROPS_V_TYPES
} from "../../api/Internals";

const fileProps: any = {
    xml: {
        version: DEFAULT_XML_VERSION,
        encoding: ENCODING_UTF_8,
        standalone: DEFAULT_STAND_ALONE
    },
    name: FILE_CUSTOM,
    extension: EXTENSION_XML,
    nodes: {
        Properties: "Properties",
        property: "property",
        vtBool: "vt:bool"
    },
    keys: {
        xmlns: "xmlns",
        xmlnsVt: "xmlns:vt",
        fmtId: "fmtid",
        pid: "pid",
        name: "name"
    },
    values: {
        fmtId: "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}", //TODO: Verify encoding
        pid: 2,
        name: "isDataCompleteCustomField"
    }
};

export default (excel: JSExcel): ___JSE_XLSX___File => ({
    fileName: fileProps.name,
    fileExtension: fileProps.extension,
    fileContent: {
        xml: {...fileProps.xml},
        content: {
            name: fileProps.nodes.Properties,
            values: [
                {key: fileProps.keys.xmlns, value: XMLNS_CUSTOM_PROPERTIES},
                {key: fileProps.keys.xmlnsVt, value: XMLNS_DOC_PROPS_V_TYPES}
            ],
            content: {
                name: fileProps.nodes.property,
                values: [
                    {key: fileProps.keys.fmtId, value: fileProps.values.fmtId},
                    {key: fileProps.keys.pid, value: fileProps.values.pid},
                    {key: fileProps.keys.name, value: fileProps.values.name}
                ],
                content: {
                    name: fileProps.nodes.vtBool,
                    content: true
                }
            }
        }
    }
});
