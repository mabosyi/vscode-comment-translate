// DeepLTranslate: endpoint selection, language mapping, request body and error
// surfacing. fetch and the extension context (SecretStorage) are mocked; no network.
const mockSecretGet = jest.fn();
jest.mock('../../../src/extension', () => ({
    ctx: { secrets: { get: (key: string) => mockSecretGet(key) } },
}));

import {
    DEEPL_SECRET_KEY, DeepLTranslate, deeplEndpoint, toDeepLSource, toDeepLTarget,
} from '../../../src/translate/DeepLTranslate';

const fetchMock = jest.fn();

beforeEach(() => {
    fetchMock.mockReset();
    mockSecretGet.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
});

function okResponse(text: string) {
    return {
        ok: true,
        status: 200,
        json: async () => ({ translations: [{ detected_source_language: 'ZH', text }] }),
    };
}

describe('DeepL helpers', () => {
    test('free keys (":fx") use api-free, other keys use api', () => {
        expect(deeplEndpoint('abc:fx')).toBe('https://api-free.deepl.com/v2/translate');
        expect(deeplEndpoint('abc')).toBe('https://api.deepl.com/v2/translate');
    });

    test('maps targets DeepL needs in regional or script form', () => {
        expect(toDeepLTarget('zh-CN')).toBe('ZH-HANS');
        expect(toDeepLTarget('zh-TW')).toBe('ZH-HANT');
        expect(toDeepLTarget('en')).toBe('EN-US');
        expect(toDeepLTarget('id')).toBe('ID');
    });

    test('omits source_lang for auto and for a source equal to the target base', () => {
        expect(toDeepLSource('auto', 'ID')).toBeUndefined();
        expect(toDeepLSource(undefined, 'ID')).toBeUndefined();
        expect(toDeepLSource('en', 'EN-US')).toBeUndefined();
        expect(toDeepLSource('zh-CN', 'ID')).toBe('ZH');
    });
});

describe('DeepLTranslate.translate', () => {
    test('posts the whole text as one entry with header auth', async () => {
        mockSecretGet.mockResolvedValue('k:fx');
        fetchMock.mockResolvedValue(okResponse('Aktifkan interupsi\nBersihkan flag'));

        const out = await new DeepLTranslate().translate('使能中断\n清除标志位', { from: 'auto', to: 'id' });

        expect(out).toBe('Aktifkan interupsi\nBersihkan flag');
        expect(mockSecretGet).toHaveBeenCalledWith(DEEPL_SECRET_KEY);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api-free.deepl.com/v2/translate');
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe('DeepL-Auth-Key k:fx');
        expect(JSON.parse(init.body)).toEqual({ text: ['使能中断\n清除标志位'], target_lang: 'ID' });
    });

    test('returns empty for blank input without reading the key or calling the network', async () => {
        expect(await new DeepLTranslate().translate('  \n ', { to: 'id' })).toBe('');
        expect(mockSecretGet).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('throws a setup hint when no key is stored', async () => {
        mockSecretGet.mockResolvedValue(undefined);

        await expect(new DeepLTranslate().translate('中断', { to: 'id' })).rejects.toThrow('Set DeepL API Key');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('surfaces status and DeepL message on non-2xx', async () => {
        mockSecretGet.mockResolvedValue('k');
        fetchMock.mockResolvedValue({
            ok: false, status: 456, statusText: 'Quota Exceeded',
            json: async () => ({ message: 'Quota exceeded' }),
        });

        await expect(new DeepLTranslate().translate('中断', { to: 'id' })).rejects.toThrow('DeepL 456: Quota exceeded');
    });

    test('falls back to statusText when the error body is not JSON', async () => {
        mockSecretGet.mockResolvedValue('k');
        fetchMock.mockResolvedValue({
            ok: false, status: 503, statusText: 'Service Unavailable',
            json: async () => { throw new SyntaxError('Unexpected token <'); },
        });

        await expect(new DeepLTranslate().translate('中断', { to: 'id' })).rejects.toThrow('DeepL 503: Service Unavailable');
    });
});
