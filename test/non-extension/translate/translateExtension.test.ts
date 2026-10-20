// TranslateExtensionProvider.applySources: chooses a single source or a fallback chain.
// TranslateManager is replaced by a Map-backed fake with the same three methods.
jest.mock('vscode', () => ({
    ...jest.requireActual('jest-mock-vscode').createVSCodeMock(jest),
    extensions: { all: [], onDidChange: jest.fn() },
}));
jest.mock('../../../src/extension', () => ({ outputChannel: { appendLine: jest.fn() } }));

import { ITranslate, TranslateManager } from 'comment-translate-manager';
import { ITranslateConfig, TranslateExtensionProvider } from '../../../src/translate/translateExtension';

class Dummy implements ITranslate {
    maxLen = 1000;
    async translate() {
        return 'ok';
    }
    link() {
        return '';
    }
}

const BUILT_IN: ITranslateConfig[] = ['Google', 'Bing', 'DeepL'].map(id => ({ title: id, ctor: Dummy, translate: id }));

function setup() {
    const registered = new Map<string, unknown>();
    const manager = {
        registry: jest.fn((id: string, ctor: unknown) => { registered.set(id, ctor); }),
        hasSource: (id: string) => registered.has(id),
        setSource: jest.fn((id: string) => (registered.has(id) ? { id } : null)),
    };
    const provider = new TranslateExtensionProvider(manager as unknown as TranslateManager, BUILT_IN);
    return { manager, provider };
}

describe('TranslateExtensionProvider.applySources', () => {
    test('no fallbacks activates the primary source alone', async () => {
        const { manager, provider } = setup();

        expect(await provider.applySources('DeepL', [])).toEqual({ id: 'DeepL' });
        expect(manager.setSource).toHaveBeenLastCalledWith('DeepL');
    });

    test('built-in fallbacks register and activate a deduplicated chain', async () => {
        const { manager, provider } = setup();

        expect(await provider.applySources('DeepL', ['DeepL', '', 'Bing'])).toEqual({ id: 'chain:DeepL>Bing' });
        expect(manager.registry).toHaveBeenCalledWith('chain:DeepL>Bing', expect.any(Function));
    });

    test('a non-built-in id keeps the primary source alone', async () => {
        const { manager, provider } = setup();

        await provider.applySources('DeepL', ['someone.ext-deepl']);

        expect(manager.setSource).toHaveBeenLastCalledWith('DeepL');
        expect(manager.registry).not.toHaveBeenCalledWith(expect.stringMatching(/^chain:/), expect.anything());
    });

    test('init falls back to Google when the primary is unknown', async () => {
        const { manager, provider } = setup();

        await provider.init('missing', []);

        expect(manager.setSource).toHaveBeenLastCalledWith('Google');
    });
});
