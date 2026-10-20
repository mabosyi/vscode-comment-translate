// LanguageModelTranslate: prompt building, client-side model selection by id,
// streamed response handling and consent errors. vscode.lm is mocked.
const mockSelectChatModels = jest.fn();
const mockGetConfig = jest.fn();

jest.mock('vscode', () => {
    class LanguageModelError extends Error {
        constructor(message?: string, public readonly code = 'Unknown') {
            super(message);
        }
    }
    class CancellationTokenSource {
        token = { isCancellationRequested: false };
        cancel = jest.fn();
        dispose = jest.fn();
    }
    return {
        lm: { selectChatModels: (...args: unknown[]) => mockSelectChatModels(...args) },
        LanguageModelChatMessage: { User: (content: string) => ({ role: 1, content }) },
        LanguageModelError,
        CancellationTokenSource,
    };
});
jest.mock('../../../src/configuration', () => ({
    getConfig: (...args: unknown[]) => mockGetConfig(...args),
}));

import { LanguageModelError } from 'vscode';
import {
    buildTranslatePrompt, LanguageModelTranslate, resolveModel,
} from '../../../src/translate/LanguageModelTranslate';

function fakeModel(id: string, vendor: string, reply: string[] | Error = []) {
    return {
        id, vendor, name: id, family: id, maxInputTokens: 1000,
        sendRequest: jest.fn(async () => {
            if (reply instanceof Error) {
                throw reply;
            }
            return { text: (async function* () { yield* reply; })() };
        }),
    };
}

beforeEach(() => {
    mockSelectChatModels.mockReset();
    mockGetConfig.mockReset();
});

describe('buildTranslatePrompt', () => {
    test('names the target language and pins the line count', () => {
        const prompt = buildTranslatePrompt('使能中断\n清除标志位', 'id');

        expect(prompt).toContain('into Indonesian');
        expect(prompt).toContain('exactly 2 line(s)');
        expect(prompt.endsWith('使能中断\n清除标志位')).toBe(true);
    });

    test('falls back to the raw code for an unknown language', () => {
        expect(buildTranslatePrompt('x', 'xx-YY')).toContain('into xx-YY');
    });
});

describe('resolveModel', () => {
    test('picks the configured id by filtering all models', async () => {
        mockSelectChatModels.mockResolvedValue([fakeModel('gpt-4o', 'copilot'), fakeModel('claude-x', 'copilot')]);

        expect((await resolveModel('claude-x')).id).toBe('claude-x');
        expect(mockSelectChatModels).toHaveBeenCalledWith();
    });

    test('defaults to the first copilot model', async () => {
        mockSelectChatModels.mockResolvedValue([fakeModel('llama', 'ollama'), fakeModel('gpt-4o', 'copilot')]);

        expect((await resolveModel('')).id).toBe('gpt-4o');
    });

    test('throws a setup hint when nothing matches', async () => {
        mockSelectChatModels.mockResolvedValue([]);

        await expect(resolveModel('')).rejects.toThrow('Select Language Model');
    });
});

describe('LanguageModelTranslate.translate', () => {
    test('joins streamed fragments and trims the trailing newline', async () => {
        mockGetConfig.mockReturnValue('');
        mockSelectChatModels.mockResolvedValue([fakeModel('gpt-4o', 'copilot', ['Aktifkan ', 'interupsi\n'])]);

        expect(await new LanguageModelTranslate().translate('使能中断', { to: 'id' })).toBe('Aktifkan interupsi');
        expect(mockGetConfig).toHaveBeenCalledWith('languageModel.id', '');
    });

    test('turns missing consent into a setup hint', async () => {
        mockGetConfig.mockReturnValue('');
        const denied = new (LanguageModelError as unknown as new (m: string, c: string) => Error)('denied', 'NoPermissions');
        mockSelectChatModels.mockResolvedValue([fakeModel('gpt-4o', 'copilot', denied)]);

        await expect(new LanguageModelTranslate().translate('中断', { to: 'id' })).rejects.toThrow('not granted');
    });

    test('blank input skips the model lookup', async () => {
        expect(await new LanguageModelTranslate().translate(' ', { to: 'id' })).toBe('');
        expect(mockSelectChatModels).not.toHaveBeenCalled();
    });
});
