import { commands, env, ProgressLocation, Selection, window } from "vscode";
import { getConfig, selectTargetLanguage } from "../configuration";
import { ctx, outputChannel } from "../extension";
// import { client } from "../extension";
import { ICommentBlock } from "../interface";
import { compileBlock } from "../syntax/compile";
import { createComment } from "../syntax/Comment";
import { containsCJK } from "../util/cjk";


export async function selectAllForType(type = 'comment') {
    let editor = window.activeTextEditor;
    if (editor) {
        // let blocks = await client.sendRequest<ICommentBlock[] | null>('getAllComment',{uri: editor.document.uri.toString(),type, range:{
        //     start: editor.selections[0].start,
        //     end: editor.selections[0].end
        // }});
        let comment = await createComment();
        let blocks = await comment.getAllComment(editor.document, type, editor.selections[0]);

        if (!blocks || blocks.length === 0) return;
        let selections = blocks.map((block => {
            const { start, end } = block.range;
            return new Selection(start.line, start.character, end.line, end.character);
        }));
        editor.selections = selections;
    }
}

export async function selectAllText() {
    return selectAllForType('text')
}

export async function selectAllComment() {
    selectAllForType('comment');
}

export async function translateAllText() {
    return translateAllForType('text')
}

export async function translateAllComment() {
    translateAllForType('comment');
}

// Translate and replace only the comments written in Chinese, Japanese or Korean.
export async function translateAllCJKComment() {
    return translateAllForType('comment', block => containsCJK(block.comment), 'No CJK comments found in this file.');
}

/**
 * Translates every block of `type` in the active editor and replaces it in place.
 * `filter` keeps only the blocks it accepts; when none is left, `noMatchMessage` (if given)
 * is shown and the document is not changed.
 */
export async function translateAllForType(type = 'comment', filter?: (block: ICommentBlock) => boolean, noMatchMessage?: string) {
    let editor = window.activeTextEditor;

    window.withProgress({
        location: ProgressLocation.Window,
        title: 'Comment Translate'
    },
        async progress => {
            if (!editor) return;
            // let blocks = await client.sendRequest<ICommentBlock[] | null>('getAllComment',{uri: editor.document.uri.toString(),type,range:{
            //     start: editor.selections[0].start,
            //     end: editor.selections[0].end
            // }});

            progress.report({ message: 'Parsing' });
            let comment = await createComment();
            let blocks = await comment.getAllComment(editor.document, type, editor.selections[0]);
            if (blocks && filter) blocks = blocks.filter(filter);

            if (!blocks || blocks.length === 0) {
                if (noMatchMessage) window.showInformationMessage(noMatchMessage);
                return;
            }

            let targetLanguage: string;
            let selectTarget = getConfig<boolean>('selectTargetLanguageWhenReplacing');
            if (selectTarget) {
                targetLanguage = await selectTargetLanguage();
                if (!targetLanguage) return;
            }
            let finishedRequests = 0
            // const translatedBlock = await compileBlock(block,document.languageId);

            // 开始请求 到 有第一个请求完成 之间可能也会间隔相当长的时间，所以开始请求时也应 report 一下进度
            progress.report({ message: 'Requesting' });

            let translates = blocks.map((async block => {
                const result = compileBlock(block, editor?.document.languageId!, targetLanguage).then(res => {
                    finishedRequests++;
                    progress.report({
                        message: `Translated ${finishedRequests} / ${blocks!.length}`
                    });
                    return res;
                });
                return result;
            }));
            let selections = blocks.map((block => {
                const { start, end } = block.range;
                return new Selection(start.line, start.character, end.line, end.character);
            }));

            //添加装饰，提醒用户正在翻译中。 部分内容会原样返回，避免用户等待
            let decoration = window.createTextEditorDecorationType({
                // color: '#FF2D00',
                // backgroundColor: "transparent",
                before: {
                    contentIconPath: ctx.asAbsolutePath('resources/icons/loading.svg'),
                }
            });
            editor.setDecorations(decoration, selections);
            try {
                let results = await Promise.all(translates);
                // Wait for the edit so the loading icon stays until the text is replaced.
                await editor.edit(builder => {
                    results.forEach(({ translatedText }, index) => {
                        let selection = selections[index];
                        translatedText && builder.replace(selection, translatedText);
                    });
                });
            } catch (e: any) {
                outputChannel.append(e.toString());
            } finally {
                decoration.dispose();
            }

        })
}


let BlackLanguages = ['markdown', 'log'];

function wrapMarkdown(text: string, languageId: string) {
    if (BlackLanguages.includes(languageId)) {
        return text;
    }
    return `\`\`\`${languageId}
${text}
\`\`\``;
}

/**
 * Quickly translate selection or clipboard text for display on Github Copilot Chat
 */
export async function quickTranslationCommand() {

    let text: string;
    let editor = window.activeTextEditor;

    if (editor?.selection?.isEmpty === false && editor.document) {
        text = wrapMarkdown(editor.document.getText(editor.selection), editor.document.languageId);
    } else {
        text = await env.clipboard.readText();
    }

    commands.executeCommand('workbench.action.chat.open', {
        query: '@translate ' + text
    });

}

/**
 * Quickly translate terminal selection for display on Github Copilot Chat
 */
export async function translateTerminalForCopilotChatCommand() {
    await commands.executeCommand('workbench.action.terminal.copySelection');
    let text = await env.clipboard.readText();

    if (!text) {
        return;
    }

    commands.executeCommand('workbench.action.chat.open', {
        query: '@translate ' + text
    });
}
