// CJK detection helper. Pure (no vscode import) so it can be unit-tested directly.
// Adapted from the CJK range idea in paulengineer/vscode-comment-translate (MIT).

// Hiragana + Katakana (U+3040-30FF), CJK Extension A (U+3400-4DBF), CJK Unified Ideographs
// (U+4E00-9FFF), CJK Compatibility Ideographs (U+F900-FAFF), Hangul Syllables (U+AC00-D7AF).
// ponytail: BMP only; Extension B+ ideographs (U+20000 and up) and fullwidth punctuation alone
// do not match. Add the `u` flag and the extra ranges if rare characters must be detected.
const CJK_PATTERN = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/;

/** Returns true when `text` contains at least one Chinese, Japanese or Korean character. */
export function containsCJK(text: string): boolean {
    return CJK_PATTERN.test(text);
}
