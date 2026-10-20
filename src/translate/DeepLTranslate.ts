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

// Rate limiting. Measured 2026-10-20: browse mode fired 575 requests and 483 failed with
// 429 once the Free key was throttled. DeepL's guidance is to retry 429/529 and
// 500/503/504 with exponential backoff and never to retry 403/456 or other 4xx.
const MAX_CONCURRENT_REQUESTS = 2;
const RETRY_DELAYS_MS = [1000, 2000];
const MAX_RETRY_AFTER_MS = 5000;
const RETRYABLE_STATUS = new Set([429, 500, 503, 504, 529]);

// ponytail: one process-wide gate with MAX_CONCURRENT_REQUESTS lanes, held across retries
// so a throttled key backs off instead of being hammered; queued hovers wait behind browse
// mode. Upgrade path: batch several texts per request (DeepL accepts up to 50).
let activeRequests = 0;
const waitingRequests: (() => void)[] = [];

async function withRequestSlot<T>(run: () => Promise<T>): Promise<T> {
    if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
        // The releasing request hands its slot over, so activeRequests stays unchanged.
        await new Promise<void>(resolve => waitingRequests.push(resolve));
    } else {
        activeRequests++;
    }
    try {
        return await run();
    } finally {
        const next = waitingRequests.shift();
        if (next) {
            next();
        } else {
            activeRequests--;
        }
    }
}

function retryDelayMs(res: Response, attempt: number): number {
    const retryAfterSeconds = Number(res.headers?.get('retry-after'));
    return retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS)
        : RETRY_DELAYS_MS[attempt];
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

    // At most MAX_CONCURRENT_REQUESTS requests run at once; a retryable status is retried
    // after RETRY_DELAYS_MS (or Retry-After, capped) while the slot is held, then thrown so a
    // fallback chain can take over. Timeouts are not retried.
    async _translate(content: string, { from, to = 'en' }: { from?: string; to?: string }): Promise<string> {
        if (!content.trim()) {
            return '';
        }
        // ponytail: the key is read from SecretStorage on every call (no memo), so a key
        // change takes effect immediately. If SecretStorage latency ever shows up, memoize it
        // and invalidate with a single ctx.secrets.onDidChange listener registered once.
        const key = await ctx.secrets.get(DEEPL_SECRET_KEY);
        if (!key) {
            throw new Error('DeepL API key is not set. Run "Comment Translate: Set DeepL API Key".');
        }
        const targetLang = toDeepLTarget(to);
        const body = JSON.stringify({
            text: [content],
            target_lang: targetLang,
            source_lang: toDeepLSource(from, targetLang),
        });
        return withRequestSlot(async () => {
            for (let attempt = 0; ; attempt++) {
                const res = await fetch(deeplEndpoint(key), {
                    method: 'POST',
                    headers: {
                        Authorization: `DeepL-Auth-Key ${key}`,
                        'Content-Type': 'application/json',
                    },
                    body,
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                });
                if (res.ok) {
                    const result = await res.json() as { translations?: { text: string }[] };
                    return result.translations?.[0]?.text ?? '';
                }
                if (RETRYABLE_STATUS.has(res.status) && attempt < RETRY_DELAYS_MS.length) {
                    await sleep(retryDelayMs(res, attempt));
                    continue;
                }
                throw new Error(`DeepL ${res.status}: ${await readErrorMessage(res)}`);
            }
        });
    }

    override link(content: string, { to = 'en' }: ITranslateOptions): string {
        const target = toDeepLTarget(to).toLowerCase();
        return `[DeepL](https://www.deepl.com/translator#auto/${target}/${encodeMarkdownUriComponent(content)})`;
    }
}
