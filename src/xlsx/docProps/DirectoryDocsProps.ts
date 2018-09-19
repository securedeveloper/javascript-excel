// TODO: Tier-02 Replace values when file properties module is implemented
import {JSExcel} from "../../Types";
import {___JSE_XLSX___Directory, ___JSE_XLSX___File} from "../../api/xlsx";
import {DIRECTORY_DOC_PROPS} from "../../api/Internals";
import appFile from "./FileDocPropsApp";
import coreFile from "./FileDocPropsCore";
import customFile from "./FileDocPropsCustom";

const directoryProps: any = {
    name: DIRECTORY_DOC_PROPS
};

export default (excel: JSExcel): ___JSE_XLSX___Directory => ({
    directoryName: directoryProps.name,
    content: getRelDirectoryFiles(excel)
});

function getRelDirectoryFiles(excel: JSExcel): Array<___JSE_XLSX___File> {
    return [appFile(excel), coreFile(excel), customFile(excel)];
}
