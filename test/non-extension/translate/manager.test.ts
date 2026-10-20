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
import { cachedTranslate, getFallbackSources, initTranslate, translateManager } from '../../../src/translate/manager';

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
