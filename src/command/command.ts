import { commands, ExtensionContext, window } from "vscode";
import { changeTargetLanguage, changeTranslateSource, openOutputPannel, toggleBrowseMode, toggleEnableHover, toggleMultiLineMerge, toggleTempBrowseMode } from "./changeTargetLanguage";
import { quickTranslationCommand, selectAllComment, selectAllText, translateAllCJKComment, translateAllComment, translateAllText, translateTerminalForCopilotChatCommand } from "./file";
import { nameVariableCommand, replaceRange, replaceSelections } from "./replaceSelections";
import { addSelection, clipboard, selectLastHover } from "./select";
import { selectLanguageModel, setDeepLApiKey } from "./sourceSetup";
import { clearTranslationCache } from "../translate/manager";
import { commentDecorationManager } from "../languageFeature/decoration";

async function clearTranslationCacheCommand() {
    const count = await clearTranslationCache();
    // Browse mode reuses decorations for unchanged ranges, so rebuild them to drop the old text.
    commentDecorationManager.resetCommentDecoration();
    window.showInformationMessage(`Cleared ${count} cached translations. Reopen open Markdown previews to refresh them.`);
}

export function registerCommands(context: ExtensionContext) {
    context.subscriptions.push(
        commands.registerCommand('commentTranslate.select', selectLastHover),
        commands.registerCommand('commentTranslate._addSelection', addSelection),
        commands.registerCommand('commentTranslate.selectAllText', selectAllText),
        commands.registerCommand('commentTranslate.translateAllText', translateAllText),
        commands.registerCommand('commentTranslate.selectAllComment', selectAllComment),
        commands.registerCommand('commentTranslate.translateAllComment', translateAllComment),
        commands.registerCommand('commentTranslate.translateAllCJKComment', translateAllCJKComment),
        commands.registerCommand('commentTranslate.clipboard', clipboard), // delete
        commands.registerCommand('commentTranslate._replaceRange', replaceRange),
        commands.registerCommand('commentTranslate.replaceSelections', replaceSelections), // add context
        commands.registerCommand('commentTranslate._toggleMultiLineMerge', toggleMultiLineMerge),
        commands.registerCommand('commentTranslate.changeTranslateSource', changeTranslateSource),
        commands.registerCommand('commentTranslate._openOutputPannel', openOutputPannel),
        commands.registerCommand('commentTranslate.toggleEnableHover', toggleEnableHover),
        commands.registerCommand('commentTranslate.toggleBrowseMode', toggleBrowseMode), // add keyboard
        commands.registerCommand('commentTranslate.toggleDocumentBrowseMode', toggleTempBrowseMode), // add keyboard & add context
        commands.registerCommand('commentTranslate.openDocumentBrowseMode', toggleTempBrowseMode), // add keyboard & add context
        commands.registerCommand('commentTranslate.closeDocumentBrowseMode', toggleTempBrowseMode), // add keyboard & add context
        commands.registerCommand('commentTranslate.changeTargetLanguage', changeTargetLanguage),
        commands.registerCommand('commentTranslate.translateForCopilotChat', quickTranslationCommand), // add context
        commands.registerCommand('commentTranslate.translateTerminalForCopilotChat', translateTerminalForCopilotChatCommand),
        commands.registerCommand('commentTranslate.nameVariable', nameVariableCommand), // add keyboard
        commands.registerCommand('commentTranslate.setDeepLApiKey', setDeepLApiKey),
        commands.registerCommand('commentTranslate.selectLanguageModel', selectLanguageModel),
        commands.registerCommand('commentTranslate.clearTranslationCache', clearTranslationCacheCommand),
    );
}
