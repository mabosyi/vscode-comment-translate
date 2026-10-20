import { extensions } from "vscode";
import { ITranslate, TranslateManager } from "comment-translate-manager";
import { createFallbackTranslate, FallbackMember } from "./FallbackTranslate";
import { outputChannel } from "../extension";

export interface ITranslateExtensionConfig extends ITranslateConfig {
    extensionId: string;
}

export interface ITranslateConfig {
    title: string;
    category?: string;
    ctor?: new () => ITranslate;
    translate: string;
}

export interface ITranslateRegistry {
    (translation: string, translate: new () => ITranslate): void;
}

export class TranslateExtensionProvider {

    static getCurrentContributions() {
        const currentContributions = extensions.all.filter(({ packageJSON = {} }) => {
            const { contributes = {} } = packageJSON;
            const { translates } = contributes;
            return translates && translates.length > 0;
        });
        return currentContributions;
    }

    private _registryConfig(conf: ITranslateExtensionConfig) {
        const { extensionId, translate: translation } = conf;
        const key = `${extensionId}-${translation}`;
        this._translateConfig.set(key, conf);
    }

    private _registryBuildInConfig(conf: ITranslateExtensionConfig) {
        const { translate: translation } = conf;
        const key = `${translation}`;
        this._translateConfig.set(key, conf);
    }

    private _translateConfig: Map<string, ITranslateExtensionConfig> = new Map();

    constructor(private _translateManager: TranslateManager, buildInTranslate: ITranslateConfig[]) {
        this.buildInTranslation(buildInTranslate);
        this.loadExtensionTranslate();
        extensions.onDidChange(()=>{
            this._translateConfig.clear();
            this.buildInTranslation(buildInTranslate);
            this.loadExtensionTranslate();
        });
    }

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
        // The key changes whenever the chain changes, so setSource builds a fresh instance then.
        // Re-applying the identical chain keeps the existing instance, which is harmless
        // because members read their key, model and config on every call.
        const key = `chain:${ids.join('>')}`;
        this._translateManager.registry(key, createFallbackTranslate(members));
        return this._translateManager.setSource(key);
    }

    getAllTransationConfig() {
        return this._translateConfig.entries();
    }

    loadExtensionTranslate() {
        let currentContributions = TranslateExtensionProvider.getCurrentContributions();

        currentContributions.forEach(extension => {
            let translates = extension.packageJSON.contributes.translates;
            for (const {translate,title,category} of translates) {
                if(title && translate) {
                    this._registryConfig({
                        extensionId: extension.id,
                        translate,
                        title,
                        category
                    });
                }
                
            }
        });
    }

    showError(msg: string) {
        outputChannel.appendLine(msg);
    }

    async switchTranslate(id: string) {
        if (this._translateManager.hasSource(id)) {
            return this._translateManager.setSource(id);
        }
        const conf = this._translateConfig.get(id);
        if (!conf) {
            this.showError(`${id} configuration not found.`);
            return null;
        };
        if (conf.extensionId !== 'BuildIn') {
            // 激活插件
            let extension = extensions.all.find((extension) => extension.id === conf.extensionId);
            // console.log('extension');
            if(!extension) return null;
            await extension.activate();
            // 执行插入点
            if (extension.exports && extension.exports.extendTranslate) {
                const registry:ITranslateRegistry = (translation, Translate) => {
                    // 注册翻译器
                    const key = `${conf.extensionId}-${translation}`;
                    this._translateManager.registry(key, Translate);
                };
                await extension.exports.extendTranslate(registry);
            }
        } else if(conf.ctor) {
            // 兼容原有配置，BuildIn的不添加前缀
            id = conf.translate;
            this._translateManager.registry(id, conf.ctor);
        }

        if (this._translateManager.hasSource(id)) {
            return this._translateManager.setSource(id);
        }
    }

    buildInTranslation(buildInTranslate: ITranslateConfig[]) {
        buildInTranslate
        .map(translate => Object.assign({ extensionId: 'BuildIn' }, translate))
        .forEach(translate => this._registryBuildInConfig(translate));
    }
}