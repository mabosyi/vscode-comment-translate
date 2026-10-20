import { BaseTranslate } from './baseTranslate';
import got from 'got';
import { ITranslateOptions,encodeMarkdownUriComponent } from 'comment-translate-manager';
import { getConfig } from '../configuration';
const querystring = require('querystring');
const GoogleToken: IGetToken = require('google-translate-token-with-mirror');
interface IGetToken {
    get(text: string, opts: {
        tld?: string,
        mirror?: string
    }): Promise<{
        name: string,
        value: string
    }>;
}

// ponytail: 'gtx' and 'at' are unofficial client values of the translate_a/single endpoint, and Google may throttle or block either at any time.
// Throttling is per client at times, but both clients were also throttled together (2026-10-20: 4 requests, each at:429 then gtx:429 or the reverse, ~1 s each).
// Measured 2026-10-20 earlier: gtx 0/10 OK and at 10/10 OK; later, interleaved: gtx 6/6 OK and at 0/6 OK.
// Rotation only helps while one bucket is free; otherwise it fails faster (~1 s instead of ~4.5 s with got's retries).
// Both return the same res[0] shape, so the parser is unchanged. On HTTP 429 we rotate to the next client once per request.
// Upgrade path: add more client values here, or a setting.
const GOOGLE_CLIENTS = ['gtx', 'at'];
// Index of the client that last answered. Written only on success, so concurrent failures cannot move it.
let googleClientIndex = 0;

export class GoogleTranslate extends BaseTranslate {
    override readonly maxLen= 500;
    async _translate(content: string, { from = 'auto', to = 'auto' }: ITranslateOptions): Promise<string> {
        let tld = getConfig<string>('googleTranslate.tld', 'com');
        let mirror = getConfig<string>('googleTranslate.mirror', '');
        let token = await GoogleToken.get(content, { tld, mirror });
        let baseUrl = 'https://translate.google.' + tld + '/translate_a/single';
        if (mirror !== "") {
            baseUrl = mirror + '/translate_a/single';
        }
        let res: any;
        // Per-request index: parallel chunks must not move the shared index while another one is retrying.
        let client = googleClientIndex;
        for (let attempt = 1; ; attempt++) {
            let data: any = {
                client: GOOGLE_CLIENTS[client],
                sl: from,
                tl: to,
                hl: to,
                dt: ['at', 'bd', 'ex', 'ld', 'md', 'qca', 'rw', 'rm', 'ss', 't'],
                ie: 'UTF-8',
                oe: 'UTF-8',
                otf: 1,
                ssel: 0,
                tsel: 0,
                kc: 7,
                q: content
            };
            data[token.name] = token.value;
            let url = baseUrl + '?' + querystring.stringify(data);
            try {
                // retry.limit 0: switch client at once on 429 instead of got's backoff retries.
                res = await got(url, {
                    timeout: {request:10000}, retry: { limit: 0 }, headers: {
                        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.102 Safari/537.36'
                    }
                }).json();
                googleClientIndex = client;
                break;
            } catch (e: any) {
                // Rotate only on 429 and only while another client is left; anything else is rethrown.
                if (e?.response?.statusCode !== 429 || attempt >= GOOGLE_CLIENTS.length) {
                    throw e;
                }
                client = (client + 1) % GOOGLE_CLIENTS.length;
            }
        }

        let sentences = res[0];
        if (!sentences || !(sentences instanceof Array)) {
            return '';
        }
        let result = sentences
            .map(([trans]) => {
                if (trans) {
                    return trans.replace(/((\/|\*|-) )/g, '$2');
                }
            })
            .join('');
        return result;
    }

    link(content: string, { to = 'auto',from='auto' }: ITranslateOptions): string {
        // [fix] 参数变化zh-cn -> zh-CN。
        // let [first, last] = to.split('-');
        // if (last) {
        //     last = last.toLocaleUpperCase();
        //     to = `${first}-${last}`;
        // }
        let tld = getConfig<string>('googleTranslate.tld', 'com');
        let str = `https://translate.google.${tld}/#view=home&op=translate&sl=${from}&tl=${to}&text=${encodeMarkdownUriComponent(content)}`;
        let mirror = getConfig<string>('googleTranslate.mirror', '');
        if (mirror !== "") {
            str = `${mirror}/#view=home&op=translate&sl=auto&tl=${to}&text=${encodeMarkdownUriComponent(content)}`;
        }
        return `[Google](${str})`;
        // return `<a href="${encodeURI(str)}">Google</a>`;
    }
}
