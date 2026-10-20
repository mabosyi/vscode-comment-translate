// updateUserSetting (src/configuration.ts): commands must save to the user profile.
// `update(key, value)` without a target writes Workspace settings when a folder is open
// (and throws when none is), so the profile kept its old value. Writing Global alone is
// not enough either: a stale workspace value outranks it, so it is removed as well.
// configuration.ts imports translate/manager (ESM-only `got`); stub it like manager.test.ts.
const mockInspect = jest.fn();
const mockUpdate = jest.fn();
jest.mock('vscode', () => {
    const actual = jest.requireActual('jest-mock-vscode').createVSCodeMock(jest);
    return {
        ...actual,
        workspace: {
            ...actual.workspace,
            getConfiguration: jest.fn(() => ({ inspect: mockInspect, update: mockUpdate })),
        },
    };
});
jest.mock('../../src/translate/manager', () => ({ translateExtensionProvider: {} }));

import { ConfigurationTarget, workspace } from 'vscode';
import { updateUserSetting } from '../../src/configuration';

describe('updateUserSetting', () => {
    beforeEach(() => {
        mockInspect.mockReset();
        mockUpdate.mockReset().mockResolvedValue(undefined);
    });

    test('writes the value to the Global (user profile) target', async () => {
        mockInspect.mockReturnValue({ key: 'commentTranslate.source', defaultValue: 'Bing', globalValue: 'Bing' });

        await updateUserSetting('source', 'DeepL');

        expect(workspace.getConfiguration).toHaveBeenCalledWith('commentTranslate');
        expect(mockInspect).toHaveBeenCalledWith('source');
        expect(mockUpdate).toHaveBeenCalledTimes(1);
        expect(mockUpdate).toHaveBeenCalledWith('source', 'DeepL', ConfigurationTarget.Global);
    });

    test('also removes a stale workspace value so it cannot hide the new value', async () => {
        mockInspect.mockReturnValue({ key: 'commentTranslate.source', defaultValue: 'Bing', workspaceValue: 'Bing' });

        await updateUserSetting('source', 'DeepL');

        expect(mockUpdate).toHaveBeenCalledTimes(2);
        expect(mockUpdate).toHaveBeenNthCalledWith(1, 'source', 'DeepL', ConfigurationTarget.Global);
        expect(mockUpdate).toHaveBeenNthCalledWith(2, 'source', undefined, ConfigurationTarget.Workspace);
    });

    test('keeps a falsy workspace value distinct from an unset one', async () => {
        mockInspect.mockReturnValue({ key: 'commentTranslate.hover.enabled', defaultValue: true, workspaceValue: false });

        await updateUserSetting('hover.enabled', true);

        expect(mockUpdate).toHaveBeenNthCalledWith(2, 'hover.enabled', undefined, ConfigurationTarget.Workspace);
    });

    test('writes Global even when inspect finds nothing', async () => {
        mockInspect.mockReturnValue(undefined);

        await updateUserSetting('multiLineMerge', true);

        expect(mockUpdate).toHaveBeenCalledTimes(1);
        expect(mockUpdate).toHaveBeenCalledWith('multiLineMerge', true, ConfigurationTarget.Global);
    });
});
