// TODO: Tier-02 Replace values when file properties module is implemented
import {JSExcel} from "../../Types";
import {___JSE_XLSX___File, ___JSE_XLSX___Node} from "../../api/xlsx";
import {getISOFormattedDate} from "../../util/Helper";
import {
    DEFAULT_PROPS_CREATOR,
    DEFAULT_PROPS_DESCRIPTION,
    DEFAULT_PROPS_KEYWORDS,
    DEFAULT_PROPS_LAST_MODIFIED_BY,
    DEFAULT_PROPS_SUBJECT,
    DEFAULT_PROPS_TITLE,
    DEFAULT_STAND_ALONE,
    DEFAULT_XML_VERSION,
    ENCODING_UTF_8,
    EXTENSION_XML,
    FILE_CORE,
    XMLNS_METADATA_CORE_PROPERTIES,
    XMLNS_DC_CORE_PROPERTIES,
    XMLNS_DCMI_TYPE_CORE_PROPERTIES,
    XMLNS_DC_TERMS_CORE_PROPERTIES,
    XMLNS_XSI_XML_SCHEMA_INSTANCE
} from "../../api/Internals";

const fileProps: any = {
    xml: {
        version: DEFAULT_XML_VERSION,
        encoding: ENCODING_UTF_8,
        standalone: DEFAULT_STAND_ALONE
    },
    name: FILE_CORE,
    extension: EXTENSION_XML,
    nodes: {
        cpCoreProperties: "cp:coreProperties",
        dcTitle: "dc:title",
        dcSubject: "dc:subject",
        dcCreator: "dc:creator",
        dcKeywords: "dc:keywords",
        dcDescription: "dc:description",
        cpLastModifiedBy: "cp:lastModifiedBy",
        dcTermsCreated: "dcterms:created",
        dcTermsModified: "dcterms:modified",
        cpCategory: "cp:category",
    },
    keys: {
        xmlnsCp: "xmlns:cp",
        xmlnsDc: "xmlns:dc",
        xmlnsDcterms: "xmlns:dcterms",
        xmlnsDcmitype: "xmlns:dcmitype",
        xmlnsXsi: "xmlns:xsi",
        xsiType: "xsi:type"
    },
    values: {
        xsiType: "dcterms:W3CDTF"
    }
};

export default (excel: JSExcel): ___JSE_XLSX___File => ({
    fileName: fileProps.name,
    fileExtension: fileProps.extension,
    fileContent: {
        xml: {...fileProps.xml},
        content: {
            name: fileProps.nodes.cpCoreProperties,
            values: [
                {key: fileProps.keys.xmlnsCp, value: XMLNS_METADATA_CORE_PROPERTIES},
                {key: fileProps.keys.xmlnsDc, value: XMLNS_DC_CORE_PROPERTIES},
                {key: fileProps.keys.xmlnsDcterms, value: XMLNS_DC_TERMS_CORE_PROPERTIES},
                {key: fileProps.keys.xmlnsDcmitype, value: XMLNS_DCMI_TYPE_CORE_PROPERTIES},
                {key: fileProps.keys.xmlnsXsi, value: XMLNS_XSI_XML_SCHEMA_INSTANCE}
            ],
            content: [
                getTitleNode(excel),
                getSubjectNode(excel),
                getCreatorNode(excel),
                getKeywordsNode(excel),
                getDescriptionNode(excel),
                getLastModifiedByNode(excel),
                getCreatedAtNode(excel),
                getModifiedAtNode(excel),
                ...getCustomCategoriesNodes(excel),
            ]
        }
    }
});

function getTitleNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.dcTitle,
        content: DEFAULT_PROPS_TITLE
    };
}

function getSubjectNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.dcSubject,
        content: DEFAULT_PROPS_SUBJECT
    };
}

function getCreatorNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.dcCreator,
        content: DEFAULT_PROPS_CREATOR
    };
}

function getKeywordsNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.dcKeywords,
        content: DEFAULT_PROPS_KEYWORDS
    };
}

function getDescriptionNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.dcDescription,
        content: DEFAULT_PROPS_DESCRIPTION
    };
}

function getLastModifiedByNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.cpLastModifiedBy,
        content: DEFAULT_PROPS_LAST_MODIFIED_BY
    };
}

function getCreatedAtNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.node.dcTermsCreated,
        values: [{key: fileProps.keys.xsiType, value: fileProps.values.xsiType}],
        content: getISOFormattedDate()
    };
}

function getModifiedAtNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.node.dcTermsModified,
        values: [{key: fileProps.keys.xsiType, value: fileProps.values.xsiType}],
        content: getISOFormattedDate()
    };
}

function getCustomCategoriesNodes(excel: JSExcel): Array<___JSE_XLSX___Node> {
    // TODO: Tier-03 Complete when document props interface is finished
    return [];
}
