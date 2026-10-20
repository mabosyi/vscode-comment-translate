// Generic VS Code language model source: any chat model registered through vscode.lm
// (GitHub Copilot or other providers). It keeps the built-in key 'Copilot' so existing
// `commentTranslate.source` values continue to work.
import { ITranslate, ITranslateOptions } from 'comment-translate-manager';
import {
    CancellationTokenSource, LanguageModelChat, LanguageModelChatMessage, LanguageModelError, lm,
} from 'vscode';
import { getConfig } from '../configuration';
import { LANGS } from '../lang';
import { withTimeout } from '../util/timeout';

const REQUEST_TIMEOUT_MS = 30000;
const LANGUAGE_NAMES = new Map(LANGS);

export const LM_SETUP_HINT =
    'Run "Comment Translate: Select Language Model" to choose a model and grant access.';

// compile.ts re-aligns translations to comment lines (translate/lineBreakFallback.ts re-splits a
// result whose line count differs), but a matching line count keeps each translated line on its own
// source line, so the prompt pins the output to exactly one line per input line and forbids
// merging, splitting, reordering or dropping lines.
export function buildTranslatePrompt(text: string, to: string): string {
    const language = LANGUAGE_NAMES.get(to) ?? to;
    const lineCount = text.split('\n').length;
    return [
        `Translate the following source-code comment for firmware engineers into ${language}.`,
        `Output exactly ${lineCount} line(s): line i of the output translates line i of the input, in the same order.`,
        'Never merge, split, reorder or drop a line; a line that needs no translation is repeated unchanged.',
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

// Some models wrap the whole answer in one code fence despite the prompt. The wrapper is removed
// only when the source has no fence of its own (otherwise a fence in the output is real content)
// and both the opening and closing fence lines are present (so a lone fence line stays). The
// opening fence may carry any info string without spaces or backticks (text, c++, c#, objective-c).
// Trailing whitespace is trimmed again afterwards, which also drops the "\r" of a CRLF reply.
// Nothing else is cleaned up.
function stripWrappingFence(output: string, input: string): string {
    if (input.includes('```')) {
        return output;
    }
    const lines = output.split('\n');
    if (lines.length >= 2 && /^```[^\s`]*\s*$/.test(lines[0]) && /^```\s*$/.test(lines[lines.length - 1])) {
        return lines.slice(1, -1).join('\n').replace(/\s+$/, '');
    }
    return output;
}

export async function translateWithModel(model: LanguageModelChat, text: string, to: string): Promise<string> {
    const cancel = new CancellationTokenSource();
    const consume = async () => {
        const response = await model.sendRequest(
            [LanguageModelChatMessage.User(buildTranslatePrompt(text, to))], {}, cancel.token);
        let out = '';
        for await (const fragment of response.text) {
            out += fragment;
        }
        return stripWrappingFence(out.replace(/\s+$/, ''), text);
    };
    try {
        return await withTimeout(consume(), REQUEST_TIMEOUT_MS, 'Language model request');
    } catch (e) {
        if (e instanceof LanguageModelError && e.code === 'NoPermissions') {
            throw new Error(`Language model access was not granted. ${LM_SETUP_HINT}`);
        }
        throw e;
    } finally {
        // Stops the provider after a timeout; harmless after a completed request.
        cancel.cancel();
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
