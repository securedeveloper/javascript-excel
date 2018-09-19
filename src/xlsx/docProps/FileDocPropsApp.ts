// TODO: Tier-02 Replace values when file properties module is implemented
import {JSExcel} from "../../Types";
import {___JSE_XLSX___File, ___JSE_XLSX___Node} from "../../api/xlsx";
import {
    DEFAULT_APP_VERSION,
    DEFAULT_APPLICATION,
    DEFAULT_COMPANY,
    DEFAULT_DOC_SECURITY,
    DEFAULT_HYPER_LINK_BASE,
    DEFAULT_HYPER_LINKS_CHANGED,
    DEFAULT_LINKS_UPTO_DATE,
    DEFAULT_MANAGER,
    DEFAULT_PUB_DATA,
    DEFAULT_SCALE_CROP,
    DEFAULT_SHARED_DOC,
    DEFAULT_WORKSHEETS,
    XMLNS_EXTENDED_PROPERTIES,
    XMLNS_DOC_PROPS_V_TYPES,
    EXTENSION_XML,
    DEFAULT_XML_VERSION,
    ENCODING_UTF_8,
    DEFAULT_STAND_ALONE,
    FILE_APP
} from "../../api/Internals";

const fileProps: any = {
    name: FILE_APP,
    extension: EXTENSION_XML,
    xml: {
        version: DEFAULT_XML_VERSION,
        encoding: ENCODING_UTF_8,
        standalone: DEFAULT_STAND_ALONE
    },
    nodes: {
        Properties: "Properties",
        Application: "Application",
        DocSecurity: "DocSecurity",
        ScaleCrop: "ScaleCrop",
        HeadingPairs: "HeadingPairs",
        TitlesOfParts: "TitlesOfParts",
        Manager: "Manager",
        Company: "Company",
        LinksUpToDate: "LinksUpToDate",
        SharedDoc: "SharedDoc",
        HyperlinkBase: "HyperlinkBase",
        HyperlinksChanged: "HyperlinksChanged",
        AppVersion: "AppVersion",
        VtVector: "vt:vector",
        VtVariant: "vt:variant",
        VtLpstr: "vt:lpstr",
        VtI4: "vt:i4"
    },
    keys: {
        xmlns: "xmlns",
        xmlnsVt: "xmlns:vt",
        size: "size",
        baseType: "baseType"
    },
    values: {
        variant: "variant",
        lpstr: "lpstr"
    }
};

export default (excel: JSExcel): ___JSE_XLSX___File => ({
    fileName: fileProps.name,
    fileExtension: fileProps.extension,
    fileContent: {
        xml: {
            ...fileProps.xml
        },
        content: {
            name: fileProps.nodes.Properties,
            values: [
                {key: fileProps.keys.xmlns, value: XMLNS_EXTENDED_PROPERTIES},
                {key: fileProps.keys.xmlnsVt, value: XMLNS_DOC_PROPS_V_TYPES}
            ],
            content: [
                getApplicationNode(excel),
                getDocSecurityNode(excel),
                getScaleCropNode(excel),
                getHeadingPairsNode(excel),
                getTitlesOfPartsNode(excel),
                getManagerNode(excel),
                getCompanyNode(excel),
                getLinksUpToDateNode(excel),
                getSharedDocNode(excel),
                getHyperlinkBaseNode(excel),
                getHyperlinksChangedNode(excel),
                getAppVersionNode(excel),
            ]
        }
    }
});

function getApplicationNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.Application,
        content: DEFAULT_APPLICATION
    };
}

function getDocSecurityNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.DocSecurity,
        content: DEFAULT_DOC_SECURITY
    };
}

function getScaleCropNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.ScaleCrop,
        content: DEFAULT_SCALE_CROP
    };
}

function getHeadingPairsNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.HeadingPairs,
        content: {
            name: fileProps.nodes.VtVector,
            values: [
                {key: fileProps.keys.size, value: 2},
                {key: fileProps.keys.baseType, value: fileProps.values.variant}
            ],
            content: [
                {
                    name: fileProps.nodes.VtVariant,
                    content: {
                        name: fileProps.nodes.VtLpstr,
                        content: DEFAULT_WORKSHEETS
                    }
                },
                {
                    name: fileProps.nodes.VtVariant,
                    content: {
                        name: fileProps.nodes.VtI4,
                        content: 1
                    }
                }
            ]
        }

    };
}

function getTitlesOfPartsNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.TitlesOfParts,
        content: {
            name: fileProps.nodes.VtVector,
            values: [
                {key: fileProps.keys.size, value: 1},
                {key: fileProps.keys.baseType, value: fileProps.values.lpstr}
            ],
            content: {
                name: fileProps.nodes.VtLpstr,
                content: DEFAULT_PUB_DATA
            }
        }
    };
}

function getManagerNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.Manager,
        content: DEFAULT_MANAGER
    };
}

function getCompanyNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.Company,
        content: DEFAULT_COMPANY
    };
}

function getLinksUpToDateNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.LinksUpToDate,
        content: DEFAULT_LINKS_UPTO_DATE
    };
}

function getSharedDocNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.SharedDoc,
        content: DEFAULT_SHARED_DOC
    };
}

function getHyperlinkBaseNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.HyperlinkBase,
        content: DEFAULT_HYPER_LINK_BASE
    };
}

function getHyperlinksChangedNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.HyperlinksChanged,
        content: DEFAULT_HYPER_LINKS_CHANGED
    };
}

function getAppVersionNode(excel: JSExcel): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.AppVersion,
        content: DEFAULT_APP_VERSION
    };
}
