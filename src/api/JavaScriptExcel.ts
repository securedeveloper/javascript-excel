import {JSEData, JSERow} from "../Types";

export default class JavaScriptExcel {
    private ___Excel___: any;
    private ___SAVE_AS___: any;
    private data: JSEData;

    constructor(jszip: any, saveAs: any) {
        this.___Excel___ = new jszip();
        this.___SAVE_AS___ = saveAs;
        this.data = [];
    }

    public setData(data: JSEData): void {
        if (data) {
            this.data = data;
        } else {
            throw ("Data is not specified or in bad shape");
        }
    }

    public downloadExcel = (): void => {
        this.___Excel___.generateAsync({type: "blob"}).then(this.saveExcelFile);
    };

    private saveExcelFile = (excelContent: any) => {
        this.___SAVE_AS___(excelContent, "Download.xlsx"); // TODO: Get File Name
    }
};
