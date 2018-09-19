export function cleanAlphaNumericString(str: string): string {
    return str ? str.replace(/\W/g, '') : str;
}

export function getISOFormattedDate(date?: Date): string {
    if (!date) {
        date = new Date();
    }

    return date.toISOString().split('.')[0] + "Z";
}
