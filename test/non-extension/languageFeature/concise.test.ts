// clearCache must forget the cached translations of concise mode, so the next redraw translates again.
const mockEditor = {
    document: { languageId: 'typescript', uri: { toString: () => 'file:///a.ts' } },
    visibleRanges: [{}],
    setDecorations: jest.fn(),
};
jest.mock('vscode', () => {
    const noop = () => ({ dispose() {} });
    return {
        window: {
            activeTextEditor: mockEditor,
            createTextEditorDecorationType: () => ({ dispose() {} }),
            onDidChangeTextEditorVisibleRanges: noop,
            onDidChangeActiveTextEditor: noop,
        },
        workspace: { onDidChangeTextDocument: noop },
        Range: class { constructor(public start: unknown, public end: unknown) {} },
    };
});
jest.mock('../../../src/configuration', () => ({
    getConfig: (key: string, def?: unknown) => (key === 'hover.concise' ? true : def),
    onConfigChange: () => ({ dispose() {} }),
}));
const mockCompileBlock = jest.fn().mockResolvedValue({ translatedText: 't', humanizeText: 'h', translateLink: '' });
jest.mock('../../../src/syntax/compile', () => ({ compileBlock: mockCompileBlock }));
const block = { comment: 'hi', range: { start: { line: 1, character: 0, translate: () => ({}) } } };
jest.mock('../../../src/syntax/Comment', () => ({
    createComment: async () => ({
        getAllComment: async (_doc: unknown, type: string) => (type === 'comment' ? [block] : []),
    }),
}));
jest.mock('../../../src/languageFeature/hoverUtil', () => ({
    createHoverMarkdownString: () => ({ md: 'md', header: 'header' }),
    hoverContents: () => [],
}));

import { conciseDecorationManager } from '../../../src/languageFeature/concise';

const flush = () => new Promise(resolve => setTimeout(resolve, 20));

describe('conciseDecorationManager.clearCache', () => {
    it('translates again after the cache is cleared', async () => {
        conciseDecorationManager.register({ subscriptions: [] } as any, ['typescript']);
        await flush();
        expect(mockCompileBlock).toHaveBeenCalledTimes(1);

        (conciseDecorationManager as any).update();
        await flush();
        expect(mockCompileBlock).toHaveBeenCalledTimes(1); // served from cache

        conciseDecorationManager.clearCache();
        await flush();
        expect(mockCompileBlock).toHaveBeenCalledTimes(2);
    });
});
