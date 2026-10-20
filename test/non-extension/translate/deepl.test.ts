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
            ok: false, status: 502, statusText: 'Bad Gateway',
            json: async () => { throw new SyntaxError('Unexpected token <'); },
        });

        await expect(new DeepLTranslate().translate('中断', { to: 'id' })).rejects.toThrow('DeepL 502: Bad Gateway');
    });
});

describe('DeepLTranslate rate limiting', () => {
    const failure = (status: number, retryAfter: string | null = null) => ({
        ok: false, status, statusText: `status ${status}`,
        headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? retryAfter : null) },
        json: async () => ({ message: `message ${status}` }),
    });
    const flushMicrotasks = async () => {
        for (let i = 0; i < 10; i++) {
            await Promise.resolve();
        }
    };

    afterEach(() => jest.useRealTimers());

    test('retries a 429 after a backoff and returns the translation', async () => {
        jest.useFakeTimers();
        mockSecretGet.mockResolvedValue('k');
        fetchMock.mockResolvedValueOnce(failure(429)).mockResolvedValueOnce(okResponse('Halo'));

        const result = new DeepLTranslate().translate('你好', { to: 'id' });
        await jest.advanceTimersByTimeAsync(1000);

        await expect(result).resolves.toBe('Halo');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test('gives up after two retries and surfaces the 429', async () => {
        jest.useFakeTimers();
        mockSecretGet.mockResolvedValue('k');
        fetchMock.mockResolvedValue(failure(429));

        const assertion = expect(new DeepLTranslate().translate('你好', { to: 'id' }))
            .rejects.toThrow('DeepL 429: message 429');
        await jest.advanceTimersByTimeAsync(3000);

        await assertion;
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    test('waits for Retry-After before retrying', async () => {
        jest.useFakeTimers();
        mockSecretGet.mockResolvedValue('k');
        fetchMock.mockResolvedValueOnce(failure(429, '2')).mockResolvedValueOnce(okResponse('Halo'));

        const result = new DeepLTranslate().translate('你好', { to: 'id' });
        await jest.advanceTimersByTimeAsync(1999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);

        await expect(result).resolves.toBe('Halo');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test('never retries a 456 quota error', async () => {
        mockSecretGet.mockResolvedValue('k');
        fetchMock.mockResolvedValue(failure(456));

        await expect(new DeepLTranslate().translate('你好', { to: 'id' })).rejects.toThrow('DeepL 456: message 456');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('runs at most two requests at once', async () => {
        mockSecretGet.mockResolvedValue('k');
        const pending: (() => void)[] = [];
        fetchMock.mockImplementation(() => new Promise(resolve => pending.push(() => resolve(okResponse('ok')))));
        const deepl = new DeepLTranslate();

        const all = Promise.all(['一', '二', '三'].map(text => deepl.translate(text, { to: 'id' })));
        await flushMicrotasks();
        expect(fetchMock).toHaveBeenCalledTimes(2);

        pending.shift()!();
        await flushMicrotasks();
        expect(fetchMock).toHaveBeenCalledTimes(3);

        pending.splice(0).forEach(release => release());
        await expect(all).resolves.toEqual(['ok', 'ok', 'ok']);
    });
});
