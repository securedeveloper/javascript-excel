export function cleanAlphaNumericString(str: string): string {
    return str ? str.replace(/\W/g, '') : str;
}
