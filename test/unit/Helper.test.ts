import {cleanAlphaNumericString, getISOFormattedDate} from "../../src/api/Helper";

describe("Helper --> ", () => {
    describe("String --> ", () => {
        test("it return a clean expected string", () => {
            const inputs: Array<string> = ["\\test\red\bob\fred\new", "±~NaNNumericApha$-and_returned0"];
            const outputs: Array<string> = ["testedobredew", "NaNNumericAphaand_returned0"];

            inputs.forEach((input: string, index: number) => {
                expect(cleanAlphaNumericString(input)).toBe(outputs[index]);
            });
        });
    });

    describe("Date --> ", () => {
        test("it should return required ISO formatted date stamp", () => {
            const inputDate: Date = new Date('05 October 2011 14:48 UTC');
            const expectedOutput: string = "2011-10-05T14:48:00Z";

            expect(getISOFormattedDate(inputDate)).toBe(expectedOutput);
        });
    });
});
