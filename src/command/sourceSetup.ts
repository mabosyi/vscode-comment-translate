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
        // Header-safe keys only: undici echoes an invalid header value in its error text.
        validateInput: value => /^[\x21-\x7E]*$/.test(value.trim())
            ? undefined
            : 'The key may contain only printable ASCII characters without spaces.',
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
