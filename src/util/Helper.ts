export function cleanAlphaNumericString(str: string): string {
    return (str && typeof str === "string") ? str.replace(/\W/g, '') : str;
}

export function getISOFormattedDate(date?: Date): string {
    if (!date || typeof date !== "object") {
        date = new Date();
    }

    return date.toISOString().split('.')[0] + "Z";
}
