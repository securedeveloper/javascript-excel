import {JSECell, JSEData, JSERow, JSESheet, JSExcel} from "../../Types";
import {___JSE_XLSX___File, ___JSE_XLSX___Node} from "../../api/xlsx";
import {
    DEFAULT_STAND_ALONE,
    DEFAULT_XML_VERSION,
    ENCODING_UTF_8,
    EXTENSION_XML,
    FILE_SHARED_STRINGS,
    XMLNS_SST
} from "../../api/Internals";
import {excelTotalCellCounter} from "../../util/ExcelUtil";


const fileProps: any = {
    xml: {
        version: DEFAULT_XML_VERSION,
        encoding: ENCODING_UTF_8,
        standalone: DEFAULT_STAND_ALONE
    },
    name: FILE_SHARED_STRINGS,
    extension: EXTENSION_XML,
    nodes: {
        sst: "sst",
        si: "si",
        t: "t"
    },
    keys: {
        xmlns: "xmlns",
        count: "count",
        uniqueCount: "uniqueCount"
    }
};

export default (excel: JSExcel): ___JSE_XLSX___File => ({
    fileName: fileProps.name,
    fileExtension: fileProps.extension,
    fileContent: {
        xml: {...fileProps.xml},
        content: {
            name: fileProps.nodes.sst,
            values: [
                {key: fileProps.keys.xmlns, value: XMLNS_SST},
                {key: fileProps.keys.count, value: getCounts(excel)},
                {key: fileProps.keys.uniqueCount, value: getCounts(excel)},
            ],
            content: getCellContentsFromExcel(excel)
        }
    }
});

function getCellContentsFromExcel(excel: JSExcel): Array<___JSE_XLSX___Node> {
    return excel.sheets.flatMap(getCellContentsFromSheet).map(getCellNode);
}

function getCellContentsFromSheet(sheet: JSESheet): Array<JSECell> {
    if (sheet == null || sheet == undefined) return [];
    const {columns, data} = sheet;
    const colArr: Array<JSECell> = columns ? columns : [];
    const dataArr: Array<JSECell> = data ? getCellContentsFromData(data) : [];

    return colArr.concat(dataArr);
}

function getCellContentsFromData(data: JSEData): Array<JSECell> {
    if (data == null || data == undefined) return [];

    return data.flatMap(getRowContent);
}

function getRowContent(row: JSERow): Array<JSECell> {
    return row.map(item => item);
}

function getCellNode(cell: JSECell): ___JSE_XLSX___Node {
    return {
        name: fileProps.nodes.si,
        content: {
            name: fileProps.node.t,
            content: cell.content
        }
    };
}

function getCounts(excel: JSExcel): number {
    // TODO: Add separate flag to count uniqueCount
    return excelTotalCellCounter(excel);
}
