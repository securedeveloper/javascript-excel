import {DIRECTORY_DOC_PROPS} from "../../api/Internals";
import {JSExcel} from "../../Types";
import {___JSE_XLSX___Directory, ___JSE_XLSX___File} from "../../api/xlsx";
import appFile from "../docProps/FileDocPropsApp";
import coreFile from "../docProps/FileDocPropsCore";
import customFile from "../docProps/FileDocPropsCustom";

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