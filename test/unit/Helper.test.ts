import {cleanAlphaNumericString, getISOFormattedDate} from "../../src/util/Helper";

describe("Helper --> ", () => {
    describe("String -->", () => {
        test("it return a clean expected string", () => {
            const inputs: Array<string> = ["\\test\red\bob\fred\new", "±~NaNNumericApha$-and_returned0"];
            const outputs: Array<string> = ["testedobredew", "NaNNumericAphaand_returned0"];

            inputs.forEach((input: string, index: number) => {
                expect(cleanAlphaNumericString(input)).toBe(outputs[index]);
            });
        });

        test("it return exact input if wrong string value is supplied", () => {
            const inputs: Array<any> = [false, undefined, true, 121, new Date(), {}, null];

            inputs.forEach((input: any) => {
                expect(cleanAlphaNumericString(input)).toBe(input);
            });
        });
    });

    describe("Date -->", () => {
        test("it should return required ISO formatted date stamp w.r.t date provided", () => {
            const inputDate: Date = new Date('05 October 2011 14:48 UTC');
            const expectedOutput: string = "2011-10-05T14:48:00Z";

            expect(getISOFormattedDate(inputDate)).toBe(expectedOutput);
        });


        test("it should return today as  ISO formatted date stamp if no arg is provided", () => {
            const expectedOutput: string = new Date().toISOString().split(".")[0] + "Z";

            expect(getISOFormattedDate()).toBe(expectedOutput);
        });
    });
});
