import {JSExcel} from "../../Types";
import {___JSE_XLSX___Directory, ___JSE_XLSX___File, ___JSE_XLSX___FileContent, ___JSE_XLSX___Node} from "../../api/xlsx";
import {
    Relationship_Target_App,
    Relationship_Target_Core,
    Relationship_Target_Custom,
    Relationship_Target_Workbook,
    Relationship_Type_App,
    Relationship_Type_Core,
    Relationship_Type_Custom,
    Relationship_Type_Workbook,
    Xmlns_RelationShips
} from "../../api/Internals";

const fileProps: any = {
    name: null,
    extension: ".rels",
    version: "1.0",
    encoding: "UTF-8",
    standalone: true,
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
    name: "_rels",
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
            values: [{key: fileProps.keys.xmlns, value: Xmlns_RelationShips}],
            content: [
                {
                    name: fileProps.nodes.Relationship,
                    values: [
                        {key: fileProps.keys.Id, value: fileProps.values.Id_rId3},
                        {key: fileProps.keys.Type, value: Relationship_Type_App},
                        {key: fileProps.keys.Target, value: Relationship_Target_App}
                    ]
                },
                {
                    name: fileProps.nodes.Relationship,
                    values: [
                        {key: fileProps.keys.Id, value: fileProps.values.Id_rId2},
                        {key: fileProps.keys.Type, value: Relationship_Type_Core},
                        {key: fileProps.keys.Target, value: Relationship_Target_Core}
                    ]
                },
                {
                    name: fileProps.nodes.Relationship,
                    values: [
                        {key: fileProps.keys.Id, value: fileProps.values.Id_rId1},
                        {key: fileProps.keys.Type, value: Relationship_Type_Workbook},
                        {key: fileProps.keys.Target, value: Relationship_Target_Workbook}
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
            {key: fileProps.keys.Type, value: Relationship_Type_Custom},
            {key: fileProps.keys.Target, value: Relationship_Target_Custom}
        ]
    };
}
