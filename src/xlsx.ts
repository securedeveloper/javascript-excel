type ___JSE_XLSX___SupportedEncoding = "UTF-8"; // TODO: Add more encoding support
type ___JSE_XLSX___NodeName =
    "Types"
    | "Default"
    | "Override"
    | "Relationships"
    | "Relationship"
    | "Properties"
    | "Application"
    | "DocSecurity"
    | "ScaleCrop"
    | "HeadingPairs"
    | "vt:vector" // TODO: Could be a separate Node/Type/Interface
    | "vt:variant" // TODO: Could be a separate Node/Type/Interface
    | "vt:lpstr"
    | "vt:i4"
    | "TitlesOfParts" | "Company" | "LinksUpToDate" | "SharedDoc" | "HyperlinksChanged" | "AppVersion"
    | "cp:coreProperties" // TODO: Could be a separate Node/Type/Interface
    | "dc:creator"
    | "cp:lastModifiedBy"
    | "dcterms:created"
    | "dcterms:modified"
    | ""; // TODO: Improve further
type ___JSE_XLSX___NodeKey =
    "xmlns"
    | "xmlns:vt"
    | "xmlns:cp"
    | "xmlns:dc"
    | "xmlns:dcterms"
    | "xmlns:dcmitype"
    | "xmlns:xsi"
    | "Extension"
    | "ContentType"
    | "PartName"
    | "Id"
    | "Type"
    | "Target"
    | "size"
    | "baseType" // TODO: Could be enum
    | "xsi:type" // TODO: Could be enum
    | "";

type ___JSE_XLSX___FileExtensionFormat = ".xml" | ".rels";
type ___JSE_XLSX___FileExtension = ___JSE_XLSX___FileExtensionFormat | Array<___JSE_XLSX___FileExtensionFormat>;
type ___JSE_XLSX___ThemeName = "theme1"; // TODO: Improve further of go with string
type ___JSE_XLSX___SheetName = "sheet" | "sheet1" | string;  // TODO: Improve further of go with string
type ___JSE_XLSX___PrinterSettingName = "printerSettings1"; // TODO: Improve further of go with string
type ___JSE_XLSX___TableName = "table1"; // TODO: Improve further of go with string
type ___JSE_XLSX___FileName =
    "[Content_Types]"
    | "app"
    | "core"
    | "custom"
    | "workbook"
    | "sharedStrings"
    | "styles"
    | ___JSE_XLSX___ThemeName
    | ___JSE_XLSX___SheetName
    | ___JSE_XLSX___TableName
    | ___JSE_XLSX___PrinterSettingName
    | null;
type ___JSE_XLSX___DirectoryName =
    "_rels"
    | "docProps"
    | "xl"
    | "Book1"
    | "printerSettings"
    | "tables"
    | "themes"
    | "worksheets";

interface ___JSE_XLSX___XMLTag {
    // TODO: Verify Tag add more props if needed
    version: string;
    encoding: ___JSE_XLSX___SupportedEncoding;
    standalone?: boolean;
}

interface ___JSE_XLSX___NodeAttribute {
    key: string | ___JSE_XLSX___NodeKey; // TODO: Make precise if possible
    value: string; // TODO: Improve if needed
}

export interface ___JSE_XLSX___Node {
    name: string | ___JSE_XLSX___NodeName; // TODO: Make Precise if possible
    values?: Array<___JSE_XLSX___NodeAttribute>;
    content?: ___JSE_XLSX___Node | Array<___JSE_XLSX___Node>;
}

export interface ___JSE_XLSX___FileContent {
    xml?: ___JSE_XLSX___XMLTag;
    content: ___JSE_XLSX___Node; // TODO: Verify if nested Nodes are needed in any file
}

export interface ___JSE_XLSX___File {
    fileName: ___JSE_XLSX___FileName;
    fileExtension: ___JSE_XLSX___FileExtension;
    fileContent: ___JSE_XLSX___FileContent;
    // TODO: add further file info as needed and verify later on
}

interface ___JSE_XLSX___Directory {
    directoryName: ___JSE_XLSX___DirectoryName;
    content?: ___JSE_XLSX___File | Array<___JSE_XLSX___File> | ___JSE_XLSX___Directory | Array<___JSE_XLSX___Directory>;
}

