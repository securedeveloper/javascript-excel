import {cleanAlphaNumericString} from "../../src/Helper";

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
});
