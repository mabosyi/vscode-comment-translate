// containsCJK: true when the text holds at least one Chinese, Japanese (kana) or Korean
// (Hangul) character; false for Latin-script text, identifiers and the empty string.
import { containsCJK } from '../../../src/util/cjk';

describe('containsCJK', () => {
    test.each([
        ['Chinese', '初始化 UART 外设'],
        ['Chinese only', '串口中断'],
        ['Japanese hiragana', 'これはテストです'],
        ['Japanese katakana', 'カタカナ'],
        ['Korean Hangul', '안녕하세요'],
        ['CJK among Latin text', 'Reset the 寄存器 before use'],
    ])('%s -> true', (_name, text) => {
        expect(containsCJK(text)).toBe(true);
    });

    test.each([
        ['English', 'Initialize the UART peripheral'],
        ['Indonesian', 'Inisialisasi periferal UART dan aktifkan interupsi'],
        ['identifier', 'UART0_IRQ'],
        ['Latin with accents', 'Überprüfung der Schnittstelle'],
        ['punctuation and digits', '// 0x40 + 12 -> (a, b);'],
        ['empty string', ''],
    ])('%s -> false', (_name, text) => {
        expect(containsCJK(text)).toBe(false);
    });
});
