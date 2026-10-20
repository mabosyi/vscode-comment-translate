// GoogleTranslate: client rotation on HTTP 429. got, the token helper and configuration
// are mocked; no network. Each test reloads the module so the shared client index starts at gtx.
const mockGot = jest.fn();
jest.mock('got', () => ({ __esModule: true, default: (url: string, opts: unknown) => mockGot(url, opts) }));
jest.mock('google-translate-token-with-mirror', () => ({ get: async () => ({ name: 'tk', value: '1' }) }));
jest.mock('../../../src/configuration', () => ({ getConfig: (_key: string, def: unknown) => def }));

type Translator = { translate(content: string, opts: { from?: string; to?: string }): Promise<string> };
let GoogleTranslate: new () => Translator;

beforeEach(() => {
    mockGot.mockReset();
    jest.isolateModules(() => {
        GoogleTranslate = require('../../../src/translate/GoogleTranslate').GoogleTranslate;
    });
});

function httpError(status: number) {
    return Object.assign(new Error(`HTTP ${status}`), { response: { statusCode: status } });
}

function clientOf(url: string) {
    return new URL(url).searchParams.get('client');
}

// Each call answers with the client name as the translated text, or fails as given.
function answerWith(fail: (client: string | null) => Error | undefined) {
    mockGot.mockImplementation((url: string) => ({
        json: async () => {
            const client = clientOf(url);
            const err = fail(client);
            if (err) throw err;
            return [[[client]]];
        },
    }));
}

function clientsCalled(): (string | null)[] {
    return mockGot.mock.calls.map(([url]) => clientOf(url as string));
}

describe('GoogleTranslate client rotation', () => {
    test('parallel calls both succeed when gtx is throttled, and the next call starts on at', async () => {
        answerWith((client) => (client === 'gtx' ? httpError(429) : undefined));
        const t = new GoogleTranslate();

        const [a, b] = await Promise.all([t.translate('x', {}), t.translate('y', {})]);
        expect(a).toBe('at');
        expect(b).toBe('at');
        expect(clientsCalled().filter((c) => c === 'gtx')).toHaveLength(2);
        expect(clientsCalled().filter((c) => c === 'at')).toHaveLength(2);

        mockGot.mockClear();
        expect(await t.translate('z', {})).toBe('at');
        expect(clientsCalled()).toEqual(['at']);
    });

    test('a non-429 error is rethrown without trying the other client', async () => {
        answerWith(() => httpError(500));
        const t = new GoogleTranslate();

        await expect(t.translate('x', {})).rejects.toThrow('HTTP 500');
        expect(clientsCalled()).toEqual(['gtx']);
    });

    test('when both clients return 429 the call rejects after exactly two requests', async () => {
        answerWith(() => httpError(429));
        const t = new GoogleTranslate();

        await expect(t.translate('x', {})).rejects.toThrow('HTTP 429');
        expect(clientsCalled()).toEqual(['gtx', 'at']);
    });
});
