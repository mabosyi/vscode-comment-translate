// Session-cache behaviour of cachedTranslate (src/translate/manager.ts).
// TranslateManager.translate resolves to '' when the source fails (HTTP 401/429,
// timeout, ...). A failed result must not be memoized, otherwise one transient
// failure keeps the text untranslated until a config change clears the cache.
// jest-mock-vscode has no `env`; getUserLanguage() reads env.language.
jest.mock('vscode', () => ({
    ...jest.requireActual('jest-mock-vscode').createVSCodeMock(jest),
    env: { language: 'en' },
}));
jest.mock('comment-translate-manager', () => ({
    TranslateManager: jest.fn().mockImplementation(() => ({
        translate: jest.fn(),
        opts: { from: 'auto', to: 'id' },
        maxLen: 10000,
    })),
}));
jest.mock('../../../src/translate/translateExtension', () => ({
    TranslateExtensionProvider: jest.fn().mockImplementation(() => ({
        init: jest.fn(),
    })),
}));
// Sources built on the ESM-only `got` are irrelevant to caching; stub them out.
jest.mock('../../../src/translate/GoogleTranslate', () => ({ GoogleTranslate: class {} }));
jest.mock('../../../src/translate/TranSmartTranslate', () => ({ TranSmartTranslate: class {} }));
jest.mock('../../../src/translate/LanguageModelTranslate', () => ({ LanguageModelTranslate: class {} }));
jest.mock('../../../src/translate/DeepLTranslate', () => ({ DeepLTranslate: class {} }));

import { ExtensionContext } from 'vscode';
import * as configuration from '../../../src/configuration';
import { cachedTranslate, clearTranslationCache, getFallbackSources, initTranslate, translateManager } from '../../../src/translate/manager';

describe('cachedTranslate', () => {
    let translate: jest.Mock;

    beforeEach(() => {
        initTranslate({ workspaceState: {} } as unknown as ExtensionContext);
        translate = translateManager.translate as jest.Mock;
    });

    test('memoizes a successful translation', async () => {
        translate.mockResolvedValueOnce('Aktifkan interupsi');

        expect(await cachedTranslate('使能中断')).toBe('Aktifkan interupsi');
        expect(await cachedTranslate('使能中断')).toBe('Aktifkan interupsi');
        expect(translate).toHaveBeenCalledTimes(1);
    });

    test('returns text already in the target language without a request', async () => {
        const indonesian = 'Aktifkan interupsi timer lalu bersihkan flag tertunda sebelum masuk mode tidur';

        expect(await cachedTranslate(indonesian, { to: 'id' })).toBe(indonesian);
        expect(translate).not.toHaveBeenCalled();
    });

    test('does not memoize a failed (empty) translation', async () => {
        translate
            .mockResolvedValueOnce('')
            .mockResolvedValueOnce('Bersihkan flag tertunda');

        expect(await cachedTranslate('清除挂起标志位')).toBe('');
        expect(await cachedTranslate('清除挂起标志位')).toBe('Bersihkan flag tertunda');
        expect(translate).toHaveBeenCalledTimes(2);
    });
});

// clearTranslationCache must drop only the keys TranslateManager writes
// (`${source}-from[${from}]to[${to}]-${text}`), never other state kept in workspaceState.
describe('clearTranslationCache', () => {
    const libraryKeys = [
        'Google-from[auto]to[id]-hello',
        'Copilot-from[en]to[zh-CN]-multi\nline text',
        'chain:DeepL>Bing-from[auto]to[id]-x',
    ];
    const foreignKeys = ['commentTranslate.lastVersion', 'from[auto]to[id]', 'note-from[auto]-to[id]-x'];
    let store: Map<string, unknown>;
    let workspaceState: { keys: jest.Mock; get: jest.Mock; update: jest.Mock };

    beforeEach(() => {
        store = new Map<string, unknown>([...libraryKeys, ...foreignKeys].map(key => [key, 'value']));
        workspaceState = {
            keys: jest.fn(() => [...store.keys()]),
            get: jest.fn((key: string) => store.get(key)),
            update: jest.fn(async (key: string, value: unknown) => {
                if (value === undefined) {
                    store.delete(key);
                } else {
                    store.set(key, value);
                }
            }),
        };
        initTranslate({ workspaceState } as unknown as ExtensionContext);
    });

    test('removes only the keys written by TranslateManager and returns their count', async () => {
        expect(await clearTranslationCache()).toBe(libraryKeys.length);
        expect([...store.keys()].sort()).toEqual([...foreignKeys].sort());
    });

    test('returns 0 and writes nothing when there is nothing to clear', async () => {
        await clearTranslationCache();
        workspaceState.update.mockClear();

        expect(await clearTranslationCache()).toBe(0);
        expect(workspaceState.update).not.toHaveBeenCalled();
    });

    test('empties the session cache so the next call translates again', async () => {
        const translate = translateManager.translate as jest.Mock;
        translate.mockResolvedValue('Hasil lama');

        await cachedTranslate('清除缓存测试');
        await cachedTranslate('清除缓存测试');
        expect(translate).toHaveBeenCalledTimes(1);

        await clearTranslationCache();
        await cachedTranslate('清除缓存测试');
        expect(translate).toHaveBeenCalledTimes(2);
    });
});

// getFallbackSources guards the raw settings.json value (trust boundary).
describe('getFallbackSources', () => {
    afterEach(() => jest.restoreAllMocks());

    test('keeps only string ids from an array', () => {
        jest.spyOn(configuration, 'getConfig').mockReturnValue(['Copilot', 3, 'Bing']);
        expect(getFallbackSources()).toEqual(['Copilot', 'Bing']);
    });

    test('returns an empty list for a non-array value', () => {
        jest.spyOn(configuration, 'getConfig').mockReturnValue('Bing');
        expect(getFallbackSources()).toEqual([]);
    });
});
