import {___JSE_DownloadFileExtension} from "./constants";
import JavascriptExcel from "./JavaScriptExcel";

interface IJavaScriptExcel {
    new(jszip: any, saveAs: Function): JavascriptExcel;
}

export declare module JSExcel {
    export type JSEFileExtension = ___JSE_DownloadFileExtension;
    export type JSXLX = IJavaScriptExcel;
}

export default JavascriptExcel;
