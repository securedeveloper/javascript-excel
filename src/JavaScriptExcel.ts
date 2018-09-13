export default class JavaScriptExcel {
    private ___Excel___: any;
    private ___SAVE_AS___: any;

    constructor(jszip: any, saveAs: Function) {
        this.___Excel___ = new jszip();
        this.___SAVE_AS___ = saveAs;
    }

    public downloadExcel = (): void => {
        this.___Excel___.generateAsync({type: "blob"}).then(this.saveExcelFile);
    };

    private saveExcelFile = (excelContent: any) => {
        this.___SAVE_AS___(excelContent, "Download.xlsx"); // TODO: Get File Name
    }
};
