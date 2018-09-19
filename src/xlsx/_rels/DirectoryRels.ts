import {JSExcel} from "../../Types";
import {
    ___JSE_XLSX___Directory,
    ___JSE_XLSX___File,
    ___JSE_XLSX___FileContent,
    ___JSE_XLSX___Node
} from "../../api/xlsx";
import {
    RELATIONSHIP_TARGET_APP,
    RELATIONSHIP_TARGET_CORE,
    RELATIONSHIP_TARGET_CUSTOM,
    RELATIONSHIP_TARGET_WORKBOOK,
    RELATIONSHIP_TYPE_APP,
    RELATIONSHIP_TYPE_CORE,
    RELATIONSHIP_TYPE_CUSTOM,
    RELATION_TYPE_WORKBOOK,
    XMLNS_RELATIONSHIPS,
    EXTENSION_RELS,
    DEFAULT_XML_VERSION,
    ENCODING_UTF_8,
    DEFAULT_STAND_ALONE, FILE_RELS
} from "../../api/Internals";

const fileProps: any = {
    name: null,
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
    },
    values: {
        Id_rId3: "rId3",
        Id_rId2: "rId2",
        Id_rId1: "rId1",
        Id_rId4: "rId4"
    }
};

const directorProps: any = {
    name: FILE_RELS,
    files: {rels: {...fileProps}}
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
                {
                    name: fileProps.nodes.Relationship,
                    values: [
                        {key: fileProps.keys.Id, value: fileProps.values.Id_rId3},
                        {key: fileProps.keys.Type, value: RELATIONSHIP_TYPE_APP},
                        {key: fileProps.keys.Target, value: RELATIONSHIP_TARGET_APP}
                    ]
                },
                {
                    name: fileProps.nodes.Relationship,
                    values: [
                        {key: fileProps.keys.Id, value: fileProps.values.Id_rId2},
                        {key: fileProps.keys.Type, value: RELATIONSHIP_TYPE_CORE},
                        {key: fileProps.keys.Target, value: RELATIONSHIP_TARGET_CORE}
                    ]
                },
                {
                    name: fileProps.nodes.Relationship,
                    values: [
                        {key: fileProps.keys.Id, value: fileProps.values.Id_rId1},
                        {key: fileProps.keys.Type, value: RELATION_TYPE_WORKBOOK},
                        {key: fileProps.keys.Target, value: RELATIONSHIP_TARGET_WORKBOOK}
                    ]
                },
                // ...getCustomRelationshipNode(excel) TODO: finish when file custom props are implemented
            ]
        }
    };
}

function getCustomRelationshipNode(excel: JSExcel): ___JSE_XLSX___Node {
    //TODO: return if custom values are provided
    return {
        name: fileProps.nodes.Relationship,
        values: [
            {key: fileProps.keys.Id, value: fileProps.values.Id_rId4},
            {key: fileProps.keys.Type, value: RELATIONSHIP_TYPE_CUSTOM},
            {key: fileProps.keys.Target, value: RELATIONSHIP_TARGET_CUSTOM}
        ]
    };
}
