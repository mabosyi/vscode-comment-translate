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
