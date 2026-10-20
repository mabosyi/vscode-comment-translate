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
// The "Clear Translation Cache" command (clearTranslationCache in manager.ts) removes them.
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
