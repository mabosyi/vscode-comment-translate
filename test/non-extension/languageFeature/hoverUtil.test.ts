// Unit tests for hoverContents(): decides whether a translation hover keeps its toolbar header.
import { hoverContents } from "../../../src/languageFeature/hoverUtil";

// hoverUtil imports ../configuration, which pulls in the translate manager (and its HTTP stack).
jest.mock("../../../src/configuration", () => ({ getConfig: jest.fn() }));

describe("hoverContents", () => {
    const header = "toolbar";
    const md = "translation";

    test("keeps the toolbar header before the translation when showToolbar is true", () => {
        expect(hoverContents(header, md, true)).toEqual([header, md]);
    });

    test("drops the toolbar header and keeps the translation when showToolbar is false", () => {
        expect(hoverContents(header, md, false)).toEqual([md]);
    });
});
