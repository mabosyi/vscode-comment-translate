# DeepL, vscode.lm generik, dan rantai fallback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambah sumber DeepL built-in, memperluas sumber Copilot menjadi sumber vscode.lm generik dengan pemilih model, dan menambah rantai fallback berurutan antar sumber built-in.

**Architecture:** Rantai fallback adalah satu `ITranslate` komposit (`createFallbackTranslate`) yang didaftarkan ke `TranslateManager` dengan key `chain:A>B>C`, jadi semua pemanggil `translateManager` tercakup tanpa diubah. `TranslateExtensionProvider.applySources` memutuskan sumber tunggal atau rantai. DeepL memakai global `fetch` dengan key di SecretStorage, dan sumber Language Model memakai `vscode.lm` dengan filter model di sisi ekstensi.

**Tech Stack:** TypeScript 5.9, VS Code API `^1.92.0` (typings terpasang 1.109), `comment-translate-manager@0.0.5`, jest 29 + ts-jest + jest-mock-vscode, webpack 5.

**Spec:** `docs/superpowers/specs/2026-10-20-deepl-lm-fallback-design.md`

## Global Constraints

- Branch kerja: `fix/translate-source-reliability`. Shell user: PowerShell 7 di Windows 11; perintah di bawah berjalan sama di PowerShell maupun Git Bash kecuali disebut lain.
- `engines.vscode` tetap `^1.92.0`. Jangan pakai `lm.selectChatModels({ id })`; ambil semua model lalu filter `m.id` di kode.
- Tidak ada dependensi npm baru. HTTP ke DeepL memakai global `fetch` dan `AbortSignal.timeout` (Node 20.14 di VS Code 1.92).
- Library `comment-translate-manager` tidak diubah.
- Komentar dan identifier kode dalam bahasa Inggris. Setiap file baru diawali komentar header singkat tentang tujuannya.
- Shortcut yang sengaja dibatasi ditandai komentar `ponytail:` yang menyebut batasnya dan jalan upgrade-nya.
- Test dijalankan dengan `npx jest --coverage=false <path>`. Suite penuh: `npx jest --coverage=false --silent`.
- `npm run lint` saat ini sudah punya satu error lama: `no-control-regex` di `src/syntax/isCode.ts:35`. Hasil lint yang diharapkan: hanya error itu.
- Pesan commit memakai Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `build:`) tanpa baris atribusi.

## File Structure

| File | Status | Tanggung jawab |
|---|---|---|
| `.gitattributes` | baru | Menjaga `test/fixtures/**` tetap LF |
| `src/translate/FallbackTranslate.ts` | baru | Komposit: coba anggota berurutan, log kegagalan |
| `src/translate/DeepLTranslate.ts` | baru | Sumber DeepL: endpoint, mapping bahasa, request, error |
| `src/translate/LanguageModelTranslate.ts` | baru, menggantikan `CopilotTranslate.ts` | Sumber vscode.lm: pemilihan model, prompt, request |
| `src/translate/CopilotTranslate.ts` | dihapus | — |
| `src/translate/translateExtension.ts` | ubah | `applySources`, `init(source, fallbacks)` |
| `src/translate/manager.ts` | ubah | Entri DeepL/LM, listener config, panggilan `init` |
| `src/command/sourceSetup.ts` | baru | Command `setDeepLApiKey`, `selectLanguageModel` |
| `src/command/command.ts` | ubah | Registrasi dua command baru |
| `package.json`, `package.nls.json` | ubah | Command, setting, string NLS |
| `README.md`, `CHANGELOG.md`, `.vscodeignore` | ubah | Dokumentasi dan isi VSIX |
| `test/non-extension/translate/*.test.ts` | baru/ubah | Unit test per unit |

---

### Task 0: Test fixtures tetap LF di checkout Windows

Repo tidak punya `.gitattributes`, dan `core.autocrlf=true` membuat `test/fixtures/comment.ts` ter-checkout CRLF. Template literal di test selalu LF, jadi `commentParse.test.ts` gagal di Windows. `vscode:prepublish` menjalankan `npm test`, sehingga kegagalan ini juga memblokir pembuatan VSIX di Task 6. Sudah diverifikasi: fixture LF membuat test itu lulus.

**Files:**
- Create: `.gitattributes`

**Interfaces:** tidak ada.

- [ ] **Step 1: Pastikan test gagal saat ini**

Run: `npx jest --coverage=false --silent test/non-extension/syntax/commentParse.test.ts`
Expected: `Tests: 1 failed, 1 skipped, 1 passed`

- [ ] **Step 2: Buat `.gitattributes`**

```gitattributes
# Fixtures are compared against LF template literals in tests; keep them LF
# even on Windows checkouts with core.autocrlf=true.
test/fixtures/** text eol=lf
```

- [ ] **Step 3: Checkout ulang fixture supaya atribut berlaku**

PowerShell:
```powershell
git ls-files test/fixtures | ForEach-Object { Remove-Item $_ }
git checkout -- test/fixtures
git ls-files --eol test/fixtures
```
Expected: setiap baris menampilkan `i/lf    w/lf`.

- [ ] **Step 4: Jalankan suite penuh**

Run: `npx jest --coverage=false --silent`
Expected: `Tests: 1 skipped, 102 passed, 103 total` dan tidak ada `FAIL`.

- [ ] **Step 5: Commit**

```bash
git add .gitattributes
git commit -m "test: keep fixtures LF so commentParse passes on Windows checkouts"
```

---

### Task 1: Sumber komposit `FallbackTranslate`

**Files:**
- Create: `src/translate/FallbackTranslate.ts`
- Test: `test/non-extension/translate/fallback.test.ts`

**Interfaces:**
- Consumes: `ITranslate`, `ITranslateOptions` dari `comment-translate-manager`; `outputChannel` dari `src/extension.ts`.
- Produces:
  - `export interface FallbackMember { id: string; ctor: new () => ITranslate }`
  - `export function createFallbackTranslate(members: FallbackMember[]): new () => ITranslate`

- [ ] **Step 1: Tulis test yang gagal**

`test/non-extension/translate/fallback.test.ts`:
```ts
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
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx jest --coverage=false test/non-extension/translate/fallback.test.ts`
Expected: FAIL, `Cannot find module '../../../src/translate/FallbackTranslate'`

- [ ] **Step 3: Implementasi**

`src/translate/FallbackTranslate.ts`:
```ts
// Composite translate source: tries member sources in order and returns the first
// non-empty result. It is registered with TranslateManager as one source, so every
// caller (hover, browse mode, markdown preview, replace) gets fallback unchanged.
import { ITranslate, ITranslateOptions } from 'comment-translate-manager';
import { outputChannel } from '../extension';

export interface FallbackMember {
    id: string;
    ctor: new () => ITranslate;
}

// ponytail: TranslateManager persists whatever a member returns under the chain key in
// workspaceState, so a fallback result is never retried with the primary source later.
// Add a clear-cache command if that becomes a problem.
export function createFallbackTranslate(members: FallbackMember[]): new () => ITranslate {
    return class FallbackTranslate implements ITranslate {
        private readonly _members = members.map(({ id, ctor }) => ({ id, translator: new ctor() }));

        // ponytail: chunk size is the smallest member limit, so Google (500) shrinks every
        // request in the chain. Re-split per member if that ever costs too much.
        readonly maxLen = Math.min(...this._members.map(({ translator }) => translator.maxLen || 1000));

        async translate(content: string, options: ITranslateOptions): Promise<string> {
            if (!content.trim()) {
                return '';
            }
            let lastError: unknown;
            for (let i = 0; i < this._members.length; i++) {
                const { id, translator } = this._members[i];
                const next = this._members[i + 1]?.id;
                try {
                    const result = await translator.translate(content, options);
                    if (result) {
                        return result;
                    }
                    this._logFailure(id, 'empty result', next);
                } catch (e) {
                    lastError = e;
                    this._logFailure(id, e instanceof Error ? e.message : String(e), next);
                }
            }
            throw lastError ?? new Error('All fallback sources returned empty results');
        }

        link(content: string, options: ITranslateOptions): string {
            return this._members[0]?.translator.link(content, options) ?? '';
        }

        private _logFailure(id: string, reason: string, next: string | undefined) {
            outputChannel.appendLine(
                `[fallback] ${id} failed: ${reason}; ${next ? `trying ${next}` : 'no more sources'}`);
        }
    };
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npx jest --coverage=false test/non-extension/translate/fallback.test.ts`
Expected: PASS, `Tests: 6 passed, 6 total`

- [ ] **Step 5: Commit**

```bash
git add src/translate/FallbackTranslate.ts test/non-extension/translate/fallback.test.ts
git commit -m "feat: add composite fallback translate source"
```

---

### Task 2: Sumber `DeepLTranslate`

**Files:**
- Create: `src/translate/DeepLTranslate.ts`
- Test: `test/non-extension/translate/deepl.test.ts`

**Interfaces:**
- Consumes: `BaseTranslate` (`src/translate/baseTranslate.ts`: `maxLen`, abstract `_translate(content, { from?, to? })`, `translate()` mengisi default `from='auto'`, `to='auto'`); `ctx` dari `src/extension.ts`; `encodeMarkdownUriComponent` dari `comment-translate-manager`.
- Produces:
  - `export const DEEPL_SECRET_KEY = 'commentTranslate.deepl.apiKey'`
  - `export function deeplEndpoint(key: string): string`
  - `export function toDeepLTarget(code: string): string`
  - `export function toDeepLSource(code: string | undefined, target: string): string | undefined`
  - `export class DeepLTranslate extends BaseTranslate` dengan `maxLen = 5000`

- [ ] **Step 1: Tulis test yang gagal**

`test/non-extension/translate/deepl.test.ts`:
```ts
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
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx jest --coverage=false test/non-extension/translate/deepl.test.ts`
Expected: FAIL, `Cannot find module '../../../src/translate/DeepLTranslate'`

- [ ] **Step 3: Implementasi**

`src/translate/DeepLTranslate.ts`:
```ts
// DeepL translate source (POST /v2/translate). The API key lives in VS Code SecretStorage
// and is set with the "Comment Translate: Set DeepL API Key" command.
import { ITranslateOptions, encodeMarkdownUriComponent } from 'comment-translate-manager';
import { ctx } from '../extension';
import { BaseTranslate } from './baseTranslate';

export const DEEPL_SECRET_KEY = 'commentTranslate.deepl.apiKey';
const REQUEST_TIMEOUT_MS = 10000;

// Targets DeepL wants in a regional or script form; other codes are upper-cased.
// EN-US and PT-BR are a design choice, ZH-HANS/ZH-HANT are DeepL's target-only codes.
const TARGET_MAP: Record<string, string> = {
    'zh-CN': 'ZH-HANS',
    'zh-TW': 'ZH-HANT',
    en: 'EN-US',
    pt: 'PT-BR',
};

// DeepL Free keys end with ":fx" and must use the api-free host.
export function deeplEndpoint(key: string): string {
    const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    return `${host}/v2/translate`;
}

export function toDeepLTarget(code: string): string {
    return TARGET_MAP[code] ?? code.toUpperCase();
}

const baseCode = (code: string) => code.split('-')[0].toUpperCase();

// source_lang is omitted for 'auto' and when it equals the target base language,
// because DeepL rejects equal source and target (e.g. EN -> EN-US) with HTTP 400.
export function toDeepLSource(code: string | undefined, target: string): string | undefined {
    if (!code || code === 'auto') {
        return undefined;
    }
    const source = baseCode(code);
    return source === baseCode(target) ? undefined : source;
}

async function readErrorMessage(res: Response): Promise<string> {
    try {
        const body = await res.json() as { message?: string; error?: { message?: string } };
        return body.message ?? body.error?.message ?? res.statusText;
    } catch {
        return res.statusText;
    }
}

export class DeepLTranslate extends BaseTranslate {
    override readonly maxLen = 5000;

    // No retry here: failures surface to the fallback chain, and failed results are not
    // cached, so the next hover retries anyway.
    async _translate(content: string, { from, to = 'en' }: { from?: string; to?: string }): Promise<string> {
        if (!content.trim()) {
            return '';
        }
        const key = await ctx.secrets.get(DEEPL_SECRET_KEY);
        if (!key) {
            throw new Error('DeepL API key is not set. Run "Comment Translate: Set DeepL API Key".');
        }
        const targetLang = toDeepLTarget(to);
        const res = await fetch(deeplEndpoint(key), {
            method: 'POST',
            headers: {
                Authorization: `DeepL-Auth-Key ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: [content],
                target_lang: targetLang,
                source_lang: toDeepLSource(from, targetLang),
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
            throw new Error(`DeepL ${res.status}: ${await readErrorMessage(res)}`);
        }
        const body = await res.json() as { translations?: { text: string }[] };
        return body.translations?.[0]?.text ?? '';
    }

    override link(content: string, { to = 'en' }: ITranslateOptions): string {
        const target = toDeepLTarget(to).toLowerCase();
        return `[DeepL](https://www.deepl.com/translator#auto/${target}/${encodeMarkdownUriComponent(content)})`;
    }
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npx jest --coverage=false test/non-extension/translate/deepl.test.ts`
Expected: PASS, `Tests: 8 passed, 8 total`

- [ ] **Step 5: Type check**

Run: `npx tsc -p ./ --noEmit`
Expected: tanpa output.

- [ ] **Step 6: Commit**

```bash
git add src/translate/DeepLTranslate.ts test/non-extension/translate/deepl.test.ts
git commit -m "feat: add built-in DeepL translate source"
```

---

### Task 3: `LanguageModelTranslate` menggantikan `CopilotTranslate`

**Files:**
- Create: `src/translate/LanguageModelTranslate.ts`
- Delete: `src/translate/CopilotTranslate.ts`
- Modify: `src/translate/manager.ts:8` (import) dan entri `Copilot` di `buildInTranslate`
- Modify: `test/non-extension/translate/manager.test.ts` (mock modul baru)
- Test: `test/non-extension/translate/languageModel.test.ts`

**Interfaces:**
- Consumes: `getConfig<T>(key, default)` dari `src/configuration.ts`; `LANGS: [string, string][]` dari `src/lang.ts`; `lm`, `LanguageModelChat`, `LanguageModelChatMessage`, `LanguageModelError`, `CancellationTokenSource` dari `vscode`.
- Produces:
  - `export const LM_SETUP_HINT: string`
  - `export function buildTranslatePrompt(text: string, to: string): string`
  - `export async function resolveModel(id: string): Promise<LanguageModelChat>`
  - `export async function translateWithModel(model: LanguageModelChat, text: string, to: string): Promise<string>`
  - `export class LanguageModelTranslate implements ITranslate` dengan `maxLen = 2000`

- [ ] **Step 1: Tulis test yang gagal**

`test/non-extension/translate/languageModel.test.ts`:
```ts
// LanguageModelTranslate: prompt building, client-side model selection by id,
// streamed response handling and consent errors. vscode.lm is mocked.
const mockSelectChatModels = jest.fn();
const mockGetConfig = jest.fn();

jest.mock('vscode', () => {
    class LanguageModelError extends Error {
        constructor(message?: string, public readonly code = 'Unknown') {
            super(message);
        }
    }
    class CancellationTokenSource {
        token = { isCancellationRequested: false };
        cancel = jest.fn();
        dispose = jest.fn();
    }
    return {
        lm: { selectChatModels: (...args: unknown[]) => mockSelectChatModels(...args) },
        LanguageModelChatMessage: { User: (content: string) => ({ role: 1, content }) },
        LanguageModelError,
        CancellationTokenSource,
    };
});
jest.mock('../../../src/configuration', () => ({
    getConfig: (...args: unknown[]) => mockGetConfig(...args),
}));

import { LanguageModelError } from 'vscode';
import {
    buildTranslatePrompt, LanguageModelTranslate, resolveModel,
} from '../../../src/translate/LanguageModelTranslate';

function fakeModel(id: string, vendor: string, reply: string[] | Error = []) {
    return {
        id, vendor, name: id, family: id, maxInputTokens: 1000,
        sendRequest: jest.fn(async () => {
            if (reply instanceof Error) {
                throw reply;
            }
            return { text: (async function* () { yield* reply; })() };
        }),
    };
}

beforeEach(() => {
    mockSelectChatModels.mockReset();
    mockGetConfig.mockReset();
});

describe('buildTranslatePrompt', () => {
    test('names the target language and pins the line count', () => {
        const prompt = buildTranslatePrompt('使能中断\n清除标志位', 'id');

        expect(prompt).toContain('into Indonesian');
        expect(prompt).toContain('exactly 2 line(s)');
        expect(prompt.endsWith('使能中断\n清除标志位')).toBe(true);
    });

    test('falls back to the raw code for an unknown language', () => {
        expect(buildTranslatePrompt('x', 'xx-YY')).toContain('into xx-YY');
    });
});

describe('resolveModel', () => {
    test('picks the configured id by filtering all models', async () => {
        mockSelectChatModels.mockResolvedValue([fakeModel('gpt-4o', 'copilot'), fakeModel('claude-x', 'copilot')]);

        expect((await resolveModel('claude-x')).id).toBe('claude-x');
        expect(mockSelectChatModels).toHaveBeenCalledWith();
    });

    test('defaults to the first copilot model', async () => {
        mockSelectChatModels.mockResolvedValue([fakeModel('llama', 'ollama'), fakeModel('gpt-4o', 'copilot')]);

        expect((await resolveModel('')).id).toBe('gpt-4o');
    });

    test('throws a setup hint when nothing matches', async () => {
        mockSelectChatModels.mockResolvedValue([]);

        await expect(resolveModel('')).rejects.toThrow('Select Language Model');
    });
});

describe('LanguageModelTranslate.translate', () => {
    test('joins streamed fragments and trims the trailing newline', async () => {
        mockGetConfig.mockReturnValue('');
        mockSelectChatModels.mockResolvedValue([fakeModel('gpt-4o', 'copilot', ['Aktifkan ', 'interupsi\n'])]);

        expect(await new LanguageModelTranslate().translate('使能中断', { to: 'id' })).toBe('Aktifkan interupsi');
        expect(mockGetConfig).toHaveBeenCalledWith('languageModel.id', '');
    });

    test('turns missing consent into a setup hint', async () => {
        mockGetConfig.mockReturnValue('');
        const denied = new (LanguageModelError as unknown as new (m: string, c: string) => Error)('denied', 'NoPermissions');
        mockSelectChatModels.mockResolvedValue([fakeModel('gpt-4o', 'copilot', denied)]);

        await expect(new LanguageModelTranslate().translate('中断', { to: 'id' })).rejects.toThrow('not granted');
    });

    test('blank input skips the model lookup', async () => {
        expect(await new LanguageModelTranslate().translate(' ', { to: 'id' })).toBe('');
        expect(mockSelectChatModels).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx jest --coverage=false test/non-extension/translate/languageModel.test.ts`
Expected: FAIL, `Cannot find module '../../../src/translate/LanguageModelTranslate'`

- [ ] **Step 3: Implementasi**

`src/translate/LanguageModelTranslate.ts`:
```ts
// Generic VS Code language model source: any chat model registered through vscode.lm
// (GitHub Copilot or other providers). It keeps the built-in key 'Copilot' so existing
// `commentTranslate.source` values continue to work.
import { ITranslate, ITranslateOptions } from 'comment-translate-manager';
import {
    CancellationTokenSource, LanguageModelChat, LanguageModelChatMessage, LanguageModelError, lm,
} from 'vscode';
import { getConfig } from '../configuration';
import { LANGS } from '../lang';

const REQUEST_TIMEOUT_MS = 30000;
const LANGUAGE_NAMES = new Map(LANGS);

export const LM_SETUP_HINT =
    'Run "Comment Translate: Select Language Model" to choose a model and grant access.';

// compile.ts re-aligns translations to comment lines only when the line count matches,
// so the prompt pins the output to exactly one line per input line.
export function buildTranslatePrompt(text: string, to: string): string {
    const language = LANGUAGE_NAMES.get(to) ?? to;
    const lineCount = text.split('\n').length;
    return [
        `Translate the following source-code comment for firmware engineers into ${language}.`,
        `Output exactly ${lineCount} line(s): line i of the output translates line i of the input, in the same order.`,
        'Keep identifiers, register and macro names, hex numbers, file paths and anything in backticks unchanged.',
        'Output only the translation, with no explanations and no code fences.',
        '',
        text,
    ].join('\n');
}

// Filters on the client because the `id` selector field is not guaranteed on VS Code 1.92.
export async function resolveModel(id: string): Promise<LanguageModelChat> {
    const models = await lm.selectChatModels();
    const model = id ? models.find(m => m.id === id) : models.find(m => m.vendor === 'copilot');
    if (!model) {
        throw new Error(`No language model available${id ? ` with id '${id}'` : ''}. ${LM_SETUP_HINT}`);
    }
    return model;
}

export async function translateWithModel(model: LanguageModelChat, text: string, to: string): Promise<string> {
    const cancel = new CancellationTokenSource();
    const timer = setTimeout(() => cancel.cancel(), REQUEST_TIMEOUT_MS);
    try {
        const response = await model.sendRequest(
            [LanguageModelChatMessage.User(buildTranslatePrompt(text, to))], {}, cancel.token);
        let out = '';
        for await (const fragment of response.text) {
            out += fragment;
        }
        return out.replace(/\s+$/, '');
    } catch (e) {
        if (e instanceof LanguageModelError && e.code === 'NoPermissions') {
            throw new Error(`Language model access was not granted. ${LM_SETUP_HINT}`);
        }
        throw e;
    } finally {
        clearTimeout(timer);
        cancel.dispose();
    }
}

export class LanguageModelTranslate implements ITranslate {
    readonly maxLen = 2000;

    async translate(content: string, { to = 'en' }: ITranslateOptions): Promise<string> {
        if (!content.trim()) {
            return '';
        }
        const model = await resolveModel(getConfig<string>('languageModel.id', ''));
        return translateWithModel(model, content, to);
    }

    link(): string {
        return '';
    }
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npx jest --coverage=false test/non-extension/translate/languageModel.test.ts`
Expected: PASS, `Tests: 8 passed, 8 total`

- [ ] **Step 5: Ganti pemakaian di `manager.ts` dan hapus `CopilotTranslate.ts`**

Cek pemakai: `git grep -n CopilotTranslate -- src test`
Expected: hanya `src/translate/manager.ts` (import dan entri `ctor`).

Di `src/translate/manager.ts`, ganti:
```ts
import { CopilotTranslate } from "./CopilotTranslate";
```
menjadi:
```ts
import { LanguageModelTranslate } from "./LanguageModelTranslate";
```
dan ganti entri:
```ts
    {
        title: 'Github Copilot translate',
        ctor: CopilotTranslate,
        translate: 'Copilot'
    },
```
menjadi:
```ts
    {
        title: 'VS Code Language Model (Copilot, ...)',
        ctor: LanguageModelTranslate,
        translate: 'Copilot'
    },
```

Hapus file lama: `git rm src/translate/CopilotTranslate.ts`

- [ ] **Step 6: Mock modul baru di `manager.test.ts`**

`manager.ts` kini mengimpor `LanguageModelTranslate`, yang mengimpor `src/configuration.ts`. Supaya test cache tetap terisolasi, di `test/non-extension/translate/manager.test.ts` tambahkan baris ini tepat setelah mock `TranSmartTranslate`:
```ts
jest.mock('../../../src/translate/LanguageModelTranslate', () => ({ LanguageModelTranslate: class {} }));
```

- [ ] **Step 7: Jalankan test terkait dan type check**

Run: `npx jest --coverage=false test/non-extension/translate`
Expected: PASS, semua suite di folder itu lulus.

Run: `npx tsc -p ./ --noEmit`
Expected: tanpa output.

- [ ] **Step 8: Commit**

```bash
git add src/translate/LanguageModelTranslate.ts src/translate/manager.ts test/non-extension/translate/languageModel.test.ts test/non-extension/translate/manager.test.ts
git commit -m "feat: generalize Copilot source to any vscode.lm chat model"
```
(`git rm` di Step 5 sudah men-stage penghapusan `CopilotTranslate.ts`.)

---

### Task 4: `applySources` di `TranslateExtensionProvider`

**Files:**
- Modify: `src/translate/translateExtension.ts` (import baru, method `init` diganti, method `applySources` ditambah)
- Test: `test/non-extension/translate/translateExtension.test.ts`

**Interfaces:**
- Consumes: `createFallbackTranslate`, `FallbackMember` dari Task 1; `TranslateManager.registry/hasSource/setSource`.
- Produces:
  - `async init(source: string, fallbacks: string[] = []): Promise<ITranslate | null | undefined>`
  - `async applySources(primary: string, fallbacks: string[] = []): Promise<ITranslate | null | undefined>`. Nilai falsy berarti tidak ada sumber yang aktif.

- [ ] **Step 1: Tulis test yang gagal**

`test/non-extension/translate/translateExtension.test.ts`:
```ts
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
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx jest --coverage=false test/non-extension/translate/translateExtension.test.ts`
Expected: FAIL, `provider.applySources is not a function` (TypeScript juga melaporkan `Property 'applySources' does not exist`).

- [ ] **Step 3: Implementasi**

Di `src/translate/translateExtension.ts`, tambahkan import setelah import `comment-translate-manager`:
```ts
import { createFallbackTranslate, FallbackMember } from "./FallbackTranslate";
```

Ganti seluruh method `init` yang sekarang:
```ts
    async init(source: string) {
        const success = await this.switchTranslate(source);
        if (!success) {
            const defaulte = await this.switchTranslate('Google');
            return defaulte;
        }
    }
```
dengan dua method berikut:
```ts
    /**
     * Activate the configured source (and fallback chain), falling back to Google
     * when nothing could be activated.
     */
    async init(source: string, fallbacks: string[] = []) {
        const translator = await this.applySources(source, fallbacks);
        if (!translator) {
            return this.switchTranslate('Google');
        }
        return translator;
    }

    /**
     * Activate `primary`, or a fallback chain of `primary` followed by `fallbacks`.
     * A chain is built only when every id is a built-in source; otherwise `primary`
     * is used alone, exactly as before fallback support existed.
     * @returns the active translator, or a falsy value when no source was activated.
     */
    async applySources(primary: string, fallbacks: string[] = []) {
        const ids = [...new Set([primary, ...fallbacks].filter(Boolean))];
        if (ids.length === 0) {
            return null;
        }
        const members: FallbackMember[] = [];
        for (const id of ids) {
            const conf = this._translateConfig.get(id);
            if (!conf || conf.extensionId !== 'BuildIn' || !conf.ctor) {
                break;
            }
            members.push({ id, ctor: conf.ctor });
        }
        if (ids.length === 1 || members.length !== ids.length) {
            if (ids.length > 1) {
                this.showError(`fallbackSources supports built-in sources only; using '${ids[0]}' alone.`);
            }
            return this.switchTranslate(ids[0]);
        }
        // The key changes whenever the chain changes, so setSource always builds a fresh instance.
        const key = `chain:${ids.join('>')}`;
        this._translateManager.registry(key, createFallbackTranslate(members));
        return this._translateManager.setSource(key);
    }
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npx jest --coverage=false test/non-extension/translate/translateExtension.test.ts`
Expected: PASS, `Tests: 4 passed, 4 total`

- [ ] **Step 5: Type check**

Run: `npx tsc -p ./ --noEmit`
Expected: tanpa output.

- [ ] **Step 6: Commit**

```bash
git add src/translate/translateExtension.ts test/non-extension/translate/translateExtension.test.ts
git commit -m "feat: activate ordered fallback chains of built-in sources"
```

---

### Task 5: Wiring, command, manifest, dan dokumentasi

**Files:**
- Modify: `src/translate/manager.ts` (`initTranslate` ditulis ulang utuh, import DeepL)
- Create: `src/command/sourceSetup.ts`
- Modify: `src/command/command.ts`
- Modify: `package.json`, `package.nls.json`
- Modify: `test/non-extension/translate/manager.test.ts`
- Modify: `README.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `DeepLTranslate`, `DEEPL_SECRET_KEY` (Task 2); `translateWithModel` (Task 3); `applySources`, `init(source, fallbacks)` (Task 4); `getConfig`, `getConfiguration`, `onConfigChange` dari `src/configuration.ts`; `ctx` dari `src/extension.ts`; `translateManager` dari `src/translate/manager.ts`.
- Produces: command `commentTranslate.setDeepLApiKey` dan `commentTranslate.selectLanguageModel`; setting `commentTranslate.fallbackSources` dan `commentTranslate.languageModel.id`.

- [ ] **Step 1: Mock DeepL di `manager.test.ts`**

`manager.ts` akan mengimpor `DeepLTranslate`, yang mengimpor `src/extension.ts` beserta seluruh graph ekstensi. Di `test/non-extension/translate/manager.test.ts`, tambahkan setelah mock `LanguageModelTranslate`:
```ts
jest.mock('../../../src/translate/DeepLTranslate', () => ({ DeepLTranslate: class {} }));
```

- [ ] **Step 2: Tulis ulang `initTranslate` di `manager.ts`**

Tambahkan import setelah import `BingTranslate`:
```ts
import { DeepLTranslate } from "./DeepLTranslate";
```

Ganti seluruh fungsi `initTranslate` dengan:
```ts
export function initTranslate(context: ExtensionContext) {

    let userLanguage = getUserLanguage();
    const targetLanguage = getConfig('targetLanguage', userLanguage);
    const sourceLanguage = getConfig('sourceLanguage', 'auto');
    // At most maxTranslationLength characters per call; TranslateManager splits them into
    // chunks sized by the active source's maxLen.
    translateManager = new TranslateManager(context.workspaceState, getConfig<number>('maxTranslationLength', 10000), { from: sourceLanguage, to: targetLanguage });
    onConfigChange('maxTranslationLength', (maxLen: number) => {
        translateManager.maxLen = maxLen;
    });
    onConfigChange('targetLanguage', (targetLanguage: string) => {
        translateManager.opts.to = targetLanguage;
        sessionTranslateCache.clear();
        // Note: pendingTranslateTasks are NOT cleared intentionally.
        // In-flight tasks use keys that include the old language code, so they cannot
        // collide with new requests (which use new keys). Clearing would only cause
        // duplicate API calls for any requests that arrive while old tasks are still running.
    });
    onConfigChange('sourceLanguage', (sourceLanguage: string) => {
        translateManager.opts.from = sourceLanguage;
        sessionTranslateCache.clear();
        // See note above regarding pendingTranslateTasks.
    });

    // Re-apply the primary source and fallback chain on every change, including manual
    // settings.json edits. See note above regarding pendingTranslateTasks.
    const applyConfiguredSources = () => {
        sessionTranslateCache.clear();
        return translateExtensionProvider.applySources(
            getConfig<string>('source', ''),
            getConfig<string[]>('fallbackSources', []),
        );
    };
    onConfigChange('source', applyConfiguredSources);
    onConfigChange('fallbackSources', applyConfiguredSources);
    // ponytail: only the session cache is cleared; workspaceState keeps results from the
    // previous model under the 'Copilot' key. Add a clear-cache command if stale output matters.
    onConfigChange('languageModel.id', () => sessionTranslateCache.clear());

    const buildInTranslate: ITranslateConfig[] = [{
        title: 'Google translate',
        ctor: GoogleTranslate,
        translate: 'Google'
    },
    {
        title: 'Bing translate',
        ctor: BingTranslate,
        translate: 'Bing'
    },
    {
        title: 'DeepL translate',
        ctor: DeepLTranslate,
        translate: 'DeepL'
    },
    {
        title: 'VS Code Language Model (Copilot, ...)',
        ctor: LanguageModelTranslate,
        translate: 'Copilot'
    },
    {
        title: 'Tencent TranSmart translate',
        ctor: TranSmartTranslate,
        translate: 'TranSmart'
    }];
    translateExtensionProvider = new TranslateExtensionProvider(translateManager, buildInTranslate);
    translateExtensionProvider.init(
        getConfig<string>('source', ''),
        getConfig<string[]>('fallbackSources', []),
    );

    return translateManager;
}
```

- [ ] **Step 3: Buat `src/command/sourceSetup.ts`**

```ts
// Commands that configure translate sources: store the DeepL API key in SecretStorage
// and pick the vscode.lm model used by the 'Copilot' source.
import { ConfigurationTarget, LanguageModelChat, lm, ProgressLocation, QuickPickItem, window } from 'vscode';
import { getConfig, getConfiguration } from '../configuration';
import { ctx } from '../extension';
import { DEEPL_SECRET_KEY } from '../translate/DeepLTranslate';
import { translateWithModel } from '../translate/LanguageModelTranslate';
import { translateManager } from '../translate/manager';

// Sample used to test a model; the request also triggers the vscode.lm consent dialog,
// which must happen in response to a user action rather than from a hover.
const MODEL_TEST_SAMPLE = '使能中断，并清除挂起标志位';

export async function setDeepLApiKey() {
    const value = await window.showInputBox({
        title: 'DeepL API Key',
        prompt: 'Free keys end with ":fx". Leave empty to remove the stored key.',
        password: true,
        ignoreFocusOut: true,
    });
    if (value === undefined) {
        return;
    }
    const key = value.trim();
    if (key) {
        await ctx.secrets.store(DEEPL_SECRET_KEY, key);
        window.showInformationMessage('DeepL API key saved.');
    } else {
        await ctx.secrets.delete(DEEPL_SECRET_KEY);
        window.showInformationMessage('DeepL API key removed.');
    }
}

interface ModelPickItem extends QuickPickItem {
    model: LanguageModelChat;
}

export async function selectLanguageModel() {
    const models = await lm.selectChatModels();
    if (models.length === 0) {
        window.showWarningMessage('No language model is registered in VS Code. Sign in to GitHub Copilot or install another model provider first.');
        return;
    }
    const current = getConfig<string>('languageModel.id', '');
    const picked = await window.showQuickPick<ModelPickItem>(
        models.map(model => ({
            label: model.name,
            description: `${model.vendor}/${model.family}${model.id === current ? ' (current)' : ''}`,
            detail: `max input tokens: ${model.maxInputTokens}`,
            model,
        })),
        { title: 'Select language model for Comment Translate', matchOnDescription: true },
    );
    if (!picked) {
        return;
    }
    try {
        const result = await window.withProgress(
            { location: ProgressLocation.Notification, title: `Testing ${picked.model.name}...` },
            () => translateWithModel(picked.model, MODEL_TEST_SAMPLE, translateManager.opts.to || 'en'),
        );
        await getConfiguration().update('languageModel.id', picked.model.id, ConfigurationTarget.Global);
        window.showInformationMessage(`Language model set to ${picked.model.name}. Test: "${MODEL_TEST_SAMPLE}" -> "${result}"`);
    } catch (e) {
        window.showErrorMessage(`Language model test failed: ${e instanceof Error ? e.message : String(e)}`);
    }
}
```

- [ ] **Step 4: Daftarkan command di `src/command/command.ts`**

Tambahkan import setelah import `./select`:
```ts
import { selectLanguageModel, setDeepLApiKey } from "./sourceSetup";
```
Tambahkan dua baris setelah registrasi `commentTranslate.nameVariable`:
```ts
        commands.registerCommand('commentTranslate.setDeepLApiKey', setDeepLApiKey),
        commands.registerCommand('commentTranslate.selectLanguageModel', selectLanguageModel),
```

- [ ] **Step 5: Kontribusi `package.json`**

Di array `contributes.commands`, tambahkan setelah entri `commentTranslate.openMarkdownTranslatePreview` (ingat koma setelah `}` entri itu):
```json
            {
                "command": "commentTranslate.setDeepLApiKey",
                "title": "%commentTranslate.command.setDeepLApiKey%",
                "category": "Comment Translate"
            },
            {
                "command": "commentTranslate.selectLanguageModel",
                "title": "%commentTranslate.command.selectLanguageModel%",
                "category": "Comment Translate"
            }
```

Di `contributes.configuration`, tambahkan tepat setelah blok `"commentTranslate.source": { ... },`:
```json
                    "commentTranslate.fallbackSources": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        },
                        "default": [],
                        "order": 27,
                        "markdownDescription": "%commentTranslate.configuration.fallbackSources%"
                    },
                    "commentTranslate.languageModel.id": {
                        "type": "string",
                        "default": "",
                        "order": 27,
                        "markdownDescription": "%commentTranslate.configuration.languageModelId%"
                    },
```

- [ ] **Step 6: String di `package.nls.json`**

Tambahkan sebelum `}` penutup (beri koma setelah entri terakhir yang ada):
```json
    "commentTranslate.command.setDeepLApiKey": "Set DeepL API Key",
    "commentTranslate.command.selectLanguageModel": "Select Language Model",
    "commentTranslate.configuration.fallbackSources": "Translate sources tried in order after `#commentTranslate.source#` fails, for example `[\"Copilot\", \"Bing\"]`. Built-in sources only: `Google`, `Bing`, `DeepL`, `Copilot`, `TranSmart`. Avoid `Google` in the chain: its 500-character limit shrinks the request size of every source.",
    "commentTranslate.configuration.languageModelId": "Language model used by the `Copilot` source. Set it with the **Comment Translate: Select Language Model** command. Empty uses the first GitHub Copilot model."
```

Verifikasi JSON valid:
```powershell
node -e "require('./package.json'); require('./package.nls.json'); console.log('ok')"
```
Expected: `ok`

- [ ] **Step 7: README dan CHANGELOG**

Di `README.md`, bagian "Translation Services", tambahkan setelah butir AliCloud:
```markdown
- **DeepL**: Built-in, requires an API key (Free keys end with `:fx`). Set it with `Comment Translate: Set DeepL API Key`; the key is stored in VS Code SecretStorage, not in settings.
- **VS Code Language Model** (`Copilot` source): Built-in, uses any chat model registered in VS Code, such as GitHub Copilot models or other providers. Pick one with `Comment Translate: Select Language Model`.
```
Di bagian "Common Configurations", tambahkan setelah butir `commentTranslate.source`:
```markdown
* `commentTranslate.fallbackSources`: Built-in sources tried in order when the main source fails, for example `["Copilot", "Bing"]`
* `commentTranslate.languageModel.id`: Model used by the `Copilot` source; set it with `Comment Translate: Select Language Model`
```

Di `CHANGELOG.md`, tepat di bawah `## [Unreleased]`, tambahkan sebelum `### Add` yang sudah ada:
```markdown
### Added
* Built-in DeepL source; the API key is stored in SecretStorage (`Comment Translate: Set DeepL API Key`).
* The `Copilot` source now works with any vscode.lm chat model (`Comment Translate: Select Language Model`).
* `commentTranslate.fallbackSources`: ordered fallback across built-in sources.

### Fixed
* Bing source: bump `bing-translate-api` to 4.3.0 (2.10.0 failed every request with 401).
* A failed translation is no longer cached for the session, so the next request retries.
```

- [ ] **Step 8: Verifikasi penuh**

Run: `npx jest --coverage=false --silent`
Expected: tidak ada `FAIL`. Jumlah test = 103 dari baseline (setelah Task 0) + 6 (Task 1) + 8 (Task 2) + 8 (Task 3) + 4 (Task 4) = 129, dengan `1 skipped`.

Run: `npx tsc -p ./ --noEmit`
Expected: tanpa output.

Run: `npm run lint`
Expected: hanya error lama `no-control-regex` di `src/syntax/isCode.ts:35`.

Run: `npx webpack --mode production --devtool hidden-source-map`
Expected: `compiled with 1 warning` (warning lama `keyv`), tanpa `ERROR`.

- [ ] **Step 9: Commit**

```bash
git add src/translate/manager.ts src/command/sourceSetup.ts src/command/command.ts package.json package.nls.json test/non-extension/translate/manager.test.ts README.md CHANGELOG.md
git commit -m "feat: wire DeepL, language model picker and fallback sources"
```

---

### Task 6: VSIX dan verifikasi manual oleh user

Task ini butuh user, karena memakai key DeepL dan akun Copilot miliknya. Agent hanya menyiapkan VSIX, lalu menyerahkan langkah manual.

**Files:**
- Modify: `.vscodeignore`

- [ ] **Step 1: Keluarkan dokumen internal dari VSIX**

Tambahkan dua baris ke `.vscodeignore`:
```
docs
CLAUDE.md
```

- [ ] **Step 2: Commit**

```bash
git add .vscodeignore
git commit -m "build: exclude internal docs from the VSIX"
```

- [ ] **Step 3: Buat VSIX**

PowerShell:
```powershell
npx --yes @vscode/vsce@3 package --out "$env:TEMP\comment-translate-fork.vsix"
```
Expected: `DONE  Packaged: ...\comment-translate-fork.vsix`. `vscode:prepublish` menjalankan jest dan webpack production lebih dulu. Kalau jest gagal, berhenti dan laporkan output-nya.

- [ ] **Step 4: Serahkan ke user untuk verifikasi manual**

Langkah untuk user, di VS Code dengan profil "Embedded Systems-Zephyr":
1. Extensions view, menu `...`, **Install from VSIX...**, pilih `%TEMP%\comment-translate-fork.vsix`, lalu reload. Matikan auto-update untuk ekstensi ini supaya build fork tidak tertimpa versi marketplace.
2. Jalankan **Comment Translate: Set DeepL API Key**, tempel key, lalu set `commentTranslate.source` ke `DeepL`. Hover komentar Mandarin multi-baris di file C. Cek apakah jumlah baris terjemahan sama dengan komentar asli. Fakta ini belum terdokumentasi oleh DeepL.
3. Jalankan **Comment Translate: Select Language Model**, pilih model, dan pastikan dialog consent muncul di sini, bukan saat hover.
4. Set `commentTranslate.fallbackSources` ke `["Copilot", "Bing"]`, hapus key DeepL lewat command yang sama dengan input kosong, lalu hover lagi. Hover harus tetap diterjemahkan, dan output channel "Comment Translate" memuat baris `[fallback] DeepL failed: DeepL API key is not set...; trying Copilot`.

Kalau langkah 2 menunjukkan jumlah baris DeepL berbeda, catat contohnya. `compile.ts` tetap menampilkan teks mentah, tapi penanda komentar hilang, sehingga perlu task lanjutan.
