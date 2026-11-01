// commentTranslate.clearTranslationCache (src/command/command.ts): after the stored
// translations are dropped, every view that keeps its own copy (browse mode, concise mode,
// Markdown previews) must be refreshed, otherwise it keeps showing the old text. Everything the command module
// imports is mocked, so only the command handler itself runs.
jest.mock('vscode', () => {
    const actual = jest.requireActual('jest-mock-vscode').createVSCodeMock(jest);
    return {
        ...actual,
        commands: { registerCommand: jest.fn() },
        window: { showInformationMessage: jest.fn() },
    };
});
jest.mock('../../../src/command/changeTargetLanguage', () => ({}));
jest.mock('../../../src/command/file', () => ({}));
jest.mock('../../../src/command/replaceSelections', () => ({}));
jest.mock('../../../src/command/select', () => ({}));
jest.mock('../../../src/command/sourceSetup', () => ({}));
jest.mock('../../../src/translate/manager', () => ({ clearTranslationCache: jest.fn() }));
jest.mock('../../../src/languageFeature/decoration', () => ({
    commentDecorationManager: { resetCommentDecoration: jest.fn() },
}));
jest.mock('../../../src/languageFeature/concise', () => ({
    conciseDecorationManager: { clearCache: jest.fn() },
}));
jest.mock('../../../src/languageFeature/markdownPreview', () => ({
    refreshTranslatedMarkdownPreviews: jest.fn(),
}));

import { commands, ExtensionContext, window } from 'vscode';
import { registerCommands } from '../../../src/command/command';
import { commentDecorationManager } from '../../../src/languageFeature/decoration';
import { conciseDecorationManager } from '../../../src/languageFeature/concise';
import { refreshTranslatedMarkdownPreviews } from '../../../src/languageFeature/markdownPreview';
import { clearTranslationCache } from '../../../src/translate/manager';

describe('commentTranslate.clearTranslationCache', () => {
    const clearMock = clearTranslationCache as jest.Mock;
    const resetMock = commentDecorationManager.resetCommentDecoration as jest.Mock;
    const conciseMock = conciseDecorationManager.clearCache as jest.Mock;
    const previewMock = refreshTranslatedMarkdownPreviews as jest.Mock;
    let handler: () => Promise<void>;

    beforeAll(() => {
        registerCommands({ subscriptions: [] } as unknown as ExtensionContext);
        const registered = (commands.registerCommand as jest.Mock).mock.calls
            .find(([id]) => id === 'commentTranslate.clearTranslationCache');
        handler = registered![1];
    });

    beforeEach(() => jest.clearAllMocks());

    test('refreshes browse, concise and preview views only after the cache is cleared', async () => {
        const order: string[] = [];
        clearMock.mockImplementation(async () => { order.push('clear'); return 3; });
        resetMock.mockImplementation(() => { order.push('reset'); });
        conciseMock.mockImplementation(() => { order.push('concise'); });
        previewMock.mockImplementation(() => { order.push('previews'); });

        await handler();

        expect(order).toEqual(['clear', 'reset', 'concise', 'previews']);
    });

    test('reports the count', async () => {
        clearMock.mockResolvedValue(3);

        await handler();

        expect(window.showInformationMessage).toHaveBeenCalledWith(
            'Cleared 3 cached translations.',
        );
    });
});
