// createFallbackTranslate: ordered fallback across member sources, failure logging,
// maxLen selection and link delegation. Member sources are in-memory stubs.
const mockAppendLine = jest.fn();
jest.mock('../../../src/extension', () => ({
    outputChannel: { appendLine: (line: string) => mockAppendLine(line) },
}));

import { ITranslate } from 'comment-translate-manager';
import { createFallbackTranslate } from '../../../src/translate/FallbackTranslate';

function source(maxLen: number, translate: jest.Mock): new () => ITranslate {
    return class implements ITranslate {
        maxLen = maxLen;
        translate(content: string, options: object) {
            return translate(content, options);
        }
        link() {
            return `link-${maxLen}`;
        }
    };
}

beforeEach(() => mockAppendLine.mockReset());

describe('createFallbackTranslate', () => {
    test('uses the next source when one throws, and logs why', async () => {
        const deepl = jest.fn().mockRejectedValue(new Error('DeepL 456: Quota exceeded'));
        const copilot = jest.fn().mockResolvedValue('Aktifkan interupsi');
        const Chain = createFallbackTranslate([
            { id: 'DeepL', ctor: source(5000, deepl) },
            { id: 'Copilot', ctor: source(2000, copilot) },
        ]);

        expect(await new Chain().translate('使能中断', { to: 'id' })).toBe('Aktifkan interupsi');
        expect(copilot).toHaveBeenCalledWith('使能中断', { to: 'id' });
        expect(mockAppendLine).toHaveBeenCalledWith(
            '[fallback] DeepL failed: DeepL 456: Quota exceeded; trying Copilot');
    });

    test('treats an empty result as a failure', async () => {
        const google = jest.fn().mockResolvedValue('');
        const bing = jest.fn().mockResolvedValue('Bersihkan flag');
        const Chain = createFallbackTranslate([
            { id: 'Google', ctor: source(500, google) },
            { id: 'Bing', ctor: source(1000, bing) },
        ]);

        expect(await new Chain().translate('清除标志位', { to: 'id' })).toBe('Bersihkan flag');
        expect(mockAppendLine).toHaveBeenCalledWith('[fallback] Google failed: empty result; trying Bing');
    });

    test('rethrows the last error when every source fails', async () => {
        const Chain = createFallbackTranslate([
            { id: 'A', ctor: source(1000, jest.fn().mockRejectedValue(new Error('first'))) },
            { id: 'B', ctor: source(1000, jest.fn().mockRejectedValue(new Error('second'))) },
        ]);

        await expect(new Chain().translate('x', { to: 'id' })).rejects.toThrow('second');
        expect(mockAppendLine).toHaveBeenLastCalledWith('[fallback] B failed: second; no more sources');
    });

    test('throws when every source returns an empty result', async () => {
        const Chain = createFallbackTranslate([
            { id: 'A', ctor: source(1000, jest.fn().mockResolvedValue('')) },
            { id: 'B', ctor: source(1000, jest.fn().mockResolvedValue('')) },
        ]);

        await expect(new Chain().translate('x', { to: 'id' }))
            .rejects.toThrow('All fallback sources returned empty results');
    });

    test('uses the smallest member maxLen and the first member link', () => {
        const Chain = createFallbackTranslate([
            { id: 'A', ctor: source(1000, jest.fn()) },
            { id: 'B', ctor: source(500, jest.fn()) },
        ]);
        const chain = new Chain();

        expect(chain.maxLen).toBe(500);
        expect(chain.link('x', {})).toBe('link-1000');
    });

    test('blank input calls no source', async () => {
        const a = jest.fn();
        const Chain = createFallbackTranslate([
            { id: 'A', ctor: source(1000, a) },
            { id: 'B', ctor: source(1000, jest.fn()) },
        ]);

        expect(await new Chain().translate('  \n', { to: 'id' })).toBe('');
        expect(a).not.toHaveBeenCalled();
    });
});
