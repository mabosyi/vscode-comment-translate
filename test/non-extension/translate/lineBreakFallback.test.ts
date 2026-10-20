// Tests for keeping a comment's line structure when a translation source merges or splits lines:
// the pure helper (normalizeTranslatedLines) and its integration in compileBlock.
jest.mock('../../../src/configuration', () => ({
    getConfig: jest.fn(),
}));

jest.mock('../../../src/translate/manager', () => ({
    translateManager: { link: jest.fn() },
    autoMutualTranslate: jest.fn(),
}));

// Every line is prose in these tests; isCode itself is covered by isCode.test.ts.
jest.mock('../../../src/syntax/isCode', () => ({
    isCode: jest.fn(async (texts: string[]) => texts.map(() => false)),
}));

import { normalizeTranslatedLines } from '../../../src/translate/lineBreakFallback';
import { compileBlock } from '../../../src/syntax/compile';
import { getConfig } from '../../../src/configuration';
import { autoMutualTranslate } from '../../../src/translate/manager';
import { ICommentBlock } from '../../../src/interface';

// Whitespace-insensitive view of the lines, used to assert that no text was lost or invented.
const squash = (lines: string[]) => lines.join(' ').replace(/\s+/g, ' ').trim();

describe('normalizeTranslatedLines', () => {
    it('returns the translation as-is when the line count already matches', () => {
        expect(normalizeTranslatedLines(['first', 'second'], 'satu\ndua')).toEqual(['satu', 'dua']);
    });

    it.each([
        [
            'English',
            'Initialize the UART peripheral. Enable the receive interrupt. Return zero on success.',
        ],
        [
            'Indonesian',
            'Inisialisasi periferal UART. Aktifkan interupsi penerimaan. Kembalikan nol jika berhasil.',
        ],
    ])('splits a one-line %s translation back into one line per source line', (_name, translation) => {
        const source = [
            'Initialize the UART peripheral.',
            'Enable the receive interrupt.',
            'Return zero on success.',
        ];

        const lines = normalizeTranslatedLines(source, translation);

        expect(lines).toHaveLength(3);
        expect(lines.every(line => line.length > 0)).toBe(true);
        expect(squash(lines)).toBe(translation);
    });

    it('puts blank lines back when the translation has one line per non-blank source line', () => {
        expect(normalizeTranslatedLines(['a', '', 'b'], 'A\nB')).toEqual(['A', '', 'B']);
    });

    it.each([['\n'], ['\r\n']])('ignores a trailing newline (%j) when counting translated lines', (eol) => {
        // Uneven line lengths: redistribution would flatten the text and cut it at other places.
        const lines = ['Satu', 'Dua tiga empat lima enam', 'Tujuh'];

        // One translated line per non-blank source line.
        expect(normalizeTranslatedLines(['aaaa', 'bbbb', 'cccc'], lines.join(eol) + eol)).toEqual(lines);
        // As many translated lines as source lines, blank ones included.
        expect(normalizeTranslatedLines(['aaaa', '', 'bbbb', 'cccc'], [lines[0], '', lines[1], lines[2]].join(eol) + eol))
            .toEqual([lines[0], '', lines[1], lines[2]]);
    });

    it('keeps a trailing blank line that mirrors a trailing blank source line', () => {
        // Four source lines, the last one blank: the translation matches line for line.
        expect(normalizeTranslatedLines(['a', '', 'b', ''], 'A B C\n\nD\n')).toEqual(['A B C', '', 'D', '']);
    });

    it('does not mistake a shorter translation of a source with blank lines for a full one', () => {
        // 4 source lines, 3 non-blank; a 3-line translation is one line per non-blank line.
        expect(normalizeTranslatedLines(['a', '', 'b', 'c'], 'A\nB\nC')).toEqual(['A', '', 'B', 'C']);
        // A 4-line translation already matches the source line for line and stays untouched.
        expect(normalizeTranslatedLines(['a', '', 'b', 'c'], 'A\n\nB\nC')).toEqual(['A', '', 'B', 'C']);
    });

    it('does not put text on a blank source line just because the line counts are equal', () => {
        // Marker-only lines are blank after the markers are stripped, e.g. the "/**" and "*/" lines.
        const lines = normalizeTranslatedLines(['', 'first line', 'second line', ''], 'Satu dua\ntiga empat\nlima enam\ntujuh delapan');

        expect(lines).toHaveLength(4);
        expect(lines[0]).toBe('');
        expect(lines[3]).toBe('');
        expect(squash(lines)).toBe('Satu dua tiga empat lima enam tujuh delapan');
    });

    it('keeps blank source lines blank when it has to redistribute a merged translation', () => {
        const translation = 'Bagian pertama dari teks ini lalu bagian kedua dari teks ini.';

        const lines = normalizeTranslatedLines(['first part of the text', '', 'second part of the text'], translation);

        expect(lines).toHaveLength(3);
        expect(lines[1]).toBe('');
        expect(lines[0].length).toBeGreaterThan(0);
        expect(lines[2].length).toBeGreaterThan(0);
        expect(squash(lines)).toBe(translation);
    });

    it('does not lose text when the translation has more lines than the source', () => {
        const lines = normalizeTranslatedLines(['one', 'two'], 'A1\nA2\nA3\nA4');

        expect(lines).toHaveLength(2);
        expect(squash(lines)).toBe('A1 A2 A3 A4');
    });

    it('prefers a whitespace break over a break inside a number', () => {
        // The proportional cut lands right after the "." of "3.14159".
        expect(normalizeTranslatedLines(['x'.repeat(10), 'y'.repeat(10)], 'Rate was 3.14159 today'))
            .toEqual(['Rate was', '3.14159 today']);
    });

    it('breaks after CJK punctuation', () => {
        const translation = '第一段翻译内容。第二段翻译内容。第三段翻译内容。';

        const lines = normalizeTranslatedLines(['first part', 'second part', 'third part'], translation);

        expect(lines).toEqual(['第一段翻译内容。', '第二段翻译内容。', '第三段翻译内容。']);
    });

    it('keeps lines near the preferred width when the source lines are uneven', () => {
        const translation = 'abcdefghi '.repeat(20).trim(); // 199 characters, a space every 10th
        const source = ['x'.repeat(100), 'y'.repeat(10), 'z'.repeat(10)];

        const lines = normalizeTranslatedLines(source, translation);

        // Proportional shares alone would put 167 characters on the first line.
        expect(lines[0].length).toBeLessThanOrEqual(80);
        expect(lines.every(line => line.length > 0)).toBe(true);
        expect(squash(lines)).toBe(translation);
    });

    it('never cuts a surrogate pair in half', () => {
        const lines = normalizeTranslatedLines(['aa', 'bb'], '😀😀😀');

        expect(lines.map(line => Array.from(line).length)).toEqual([2, 1]);
        expect(lines.join('')).toBe('😀😀😀');
    });

    it('returns blank lines for an all-blank source and an empty array for no source', () => {
        expect(normalizeTranslatedLines(['', ' '], 'ignored')).toEqual(['', '']);
        expect(normalizeTranslatedLines([], 'ignored')).toEqual([]);
    });
});

describe('compileBlock with a source that merges lines', () => {
    const mockConfig = (key: string) => {
        switch (key) {
            case 'ignore':
                return [{ languageId: 'javascript', regular: '[\\*\\s]+' }];
            default:
                return undefined;
        }
    };

    it('keeps one marked line per source line when the translation comes back as a single line', async () => {
        (getConfig as jest.Mock).mockImplementation(mockConfig);
        const merged = 'Bagian pertama dari komentar. Bagian kedua dari komentar. Bagian ketiga dari komentar.';
        (autoMutualTranslate as jest.Mock).mockResolvedValueOnce(merged);
        const block = {
            comment: '/**\n * First part of the comment.\n * Second part of the comment.\n * Third part of the comment.\n */',
            tokens: [
                { text: '/**', ignoreStart: 3, ignoreEnd: 0 },
                { text: ' * First part of the comment.', ignoreStart: 0, ignoreEnd: 0 },
                { text: ' * Second part of the comment.', ignoreStart: 0, ignoreEnd: 0 },
                { text: ' * Third part of the comment.', ignoreStart: 0, ignoreEnd: 0 },
                { text: ' */', ignoreStart: 3, ignoreEnd: 0 },
            ],
        } as unknown as ICommentBlock;

        const result = await compileBlock(block, 'javascript');

        const lines = result.translatedText.split('\n');
        expect(lines).toHaveLength(5);
        expect(lines[0]).toBe('/**');
        expect(lines[4]).toBe(' */');
        for (const line of lines.slice(1, 4)) {
            expect(line).toMatch(/^ \* \S/);
        }
        expect(squash(lines.slice(1, 4).map(line => line.slice(3)))).toBe(merged);
        // One entry per token: '' for the marker-only lines, the translated line for the rest.
        expect(result.targets).toHaveLength(5);
        expect(result.targets[0]).toBe('');
        expect(result.targets[4]).toBe('');
        expect(result.targets.slice(1, 4).every(target => target.length > 0)).toBe(true);
    });
});
