# vscode-comment-translate — konteks proyek

Fork pribadi dari `intellism/vscode-comment-translate` (remote `upstream`), origin `mabosyi/vscode-comment-translate`. Saat dipetakan (2026-10-20) master paritas penuh dengan `upstream/master` di v3.1.0. Ekstensi VS Code: terjemahkan komentar/string/hover/Markdown via TextMate + berbagai sumber terjemahan.

## Toolchain & perintah

| Hal | Nilai |
|---|---|
| Node / npm | v24.12.0 / 11.6.2 (pnpm 12.6.0 ada, tapi `package-lock.json` lebih baru dari `pnpm-lock.yaml` → pakai **npm**) |
| Install | `npm ci` |
| Test | `npx jest --coverage=false` (`npm test` selalu nyalakan coverage, lebih lambat) |
| Type check | `npx tsc -p ./ --noEmit` |
| Lint | `npm run lint` |
| Build dev / watch | `npm run webpack` / `npm run webpack-dev` (task default `.vscode/tasks.json`) |
| Package | `npm run package` (jalankan jest dulu, lalu webpack production) |
| Debug | F5 "Launch Extension" (`.vscode/launch.json`) |
| Engine | VS Code `^1.92.0`, activation `onStartupFinished`, entry `dist/extension.js` |

Baseline 2026-10-20 (fresh clone, Windows): `tsc` bersih; webpack OK (1 warning `keyv` dynamic require, benign); eslint 1 error `no-control-regex` di `src/syntax/isCode.ts:35`; jest **1 fail** `commentParse.test.ts` "【typescript】" — bukan bug kode, tapi fixture ter-checkout CRLF (`core.autocrlf=true`, repo tanpa `.gitattributes`) sementara expected template-literal LF.

## Peta arsitektur

```
activate() src/extension.ts
 ├─ getCanLanguageIds()      util/ext.ts      → context key commentTranslate.canLanguages
 ├─ initTranslate()          translate/manager.ts
 │    ├─ TranslateManager    (npm comment-translate-manager@0.0.5; cache workspaceState, chunk by ITranslate.maxLen)
 │    └─ TranslateExtensionProvider translate/translateExtension.ts
 │         built-in: Google | Bing | Copilot | TranSmart ; eksternal: contributes.translates + exports.extendTranslate
 ├─ createComment()          syntax/Comment.ts → TextMateService (vscode-textmate + oniguruma wasm) → CommentParse
 ├─ registerCommands()       command/command.ts (21 command → command/*.ts)
 ├─ registerHover()          languageFeature/hover.ts ('*' HoverProvider: komentar/seleksi + hover.content + diagnostics)
 ├─ registerCompletion()     languageFeature/completion.ts (nameVariable → change-case)
 ├─ registerChatParticipant() copilot/translate.ts (@translate, /word, /var; vscode.lm gpt-4o)
 ├─ conciseDecorationManager languageFeature/concise.ts
 ├─ registerMarkdownPreview() languageFeature/markdownPreview.ts (scheme translated-markdown://, FS+content provider)
 └─ commentDecorationManager languageFeature/decoration.ts (browse/immersive: contrast|inplace; markdown/rst/plaintext via blockParser.ts)
```

Jalur terjemahan: `compile.ts:compileBlock` → `manager.ts:autoMutualTranslate` (cld3 detect bila `mutualTranslate`) → `cachedTranslate` (session Map ≤1000 + dedupe in-flight) → `TranslateManager.translate` (workspaceState cache → `splitText` → `ITranslate.translate`).

Subsistem & file inti:

| Subsistem | File | Catatan |
|---|---|---|
| Syntax/TextMate | `syntax/TextMateService.ts`, `CommentParse.ts`, `Comment.ts`, `compile.ts`, `isCode.ts` | Grammar dari `extensions.all`; `resources/<lang>/` hanya dipakai saat `env.remoteName` (remote). `isCode.ts` = heuristik skor token, bukan flourite. |
| Markdown | `syntax/markdownDocument.ts` (1023 baris, parser line-oriented murni), `languageFeature/markdownPreview.ts`, `translatedMarkdownFs.ts` | Preview progresif batch 5, debounce 500 ms. Browse-mode markdown ada di `decoration.ts`, bukan di sini. |
| Hover/Browse | `languageFeature/hover.ts`, `hoverUtil.ts`, `decoration.ts`, `commentDecoration.ts`, `concise.ts`, `blockParser.ts`, `codelen.ts` | `codelen.ts` = placeholder CodeLens untuk spacing mode contrast. |
| Commands/Copilot | `command/*.ts`, `copilot/translate.ts`, `copilot/prompt.ts` | 5 command tak ada di `contributes.commands` (4 `_`-prefix untuk link hover + `toggleEnableHover`). |
| Translate | `translate/*.ts`, `plugin/translateAli.ts` | Ali di-expose lewat API ekstensi ini sendiri (`extendTranslate`). |

Titik perluasan:
- Sumber terjemahan built-in baru: class implement `ITranslate` (lib `comment-translate-manager`), tambah ke `buildInTranslate` di `translate/manager.ts`.
- Command baru: `command/command.ts` + `contributes.commands` + `package.nls*.json` (+ `menus`/`keybindings`).
- Slash command Copilot: `chatParticipants[0].commands` + `strategyRegistry.register` di `copilot/translate.ts`.
- Konstruk Markdown yang dilindungi: `parseInlineSegments` / `parseMarkdownLines` di `syntax/markdownDocument.ts`.
- Bahasa browse-mode non-TextMate: switch `languageId` di `decoration.ts` + `blockParser.ts`.

## Jebakan terverifikasi (baca sebelum ubah kode)

- `CommentParse` split `getText().split('\n')` → di dokumen CRLF, `\r` ikut ke teks komentar/translator. Sebab test gagal di Windows.
- `translateExtensionProvider.init()` di `manager.ts` **tidak di-await**; sampai sumber terdaftar, `translate()` reject `Translate not found.`
- Error terjemahan → lib balikin `''`. Error asli tetap tercatat di output channel lewat `_subTranslate` (`e.toString()`); baris `{}` sesudahnya cuma noise dari lib. Sejak branch `fix/translate-source-reliability`, `cachedTranslate` tidak lagi menyimpan `''` ke session cache (dulu kegagalan sesaat menempel sampai config berubah).
- `bing-translate-api` 2.x rusak terhadap Bing sekarang (`401`, terukur 0/12 pada 2026-10-20); 4.3.0 OK 12/12. Google `translate_a/single` kena `429` intermiten (~45% sukses) — batas eksternal, bukan bug kode.
- Tidak ada `deactivate()`; banyak `onDidChangeConfiguration` tak di-dispose (`configuration.ts`, `manager.ts`, `translateAli.ts` per instance).
- `Comment.ts` cache per dokumen hanya dibersihkan `onDidChangeTextDocument`, tidak pada close.
- `markdownDocument.ts` pakai Map modul-level (`lineInlineSegments`, `tableRowCellSegments`) yang di-reset tiap parse → race bila 2 preview paralel.
- `package.json` `maxTranslationLength` type `number` tapi default string `"10000"`.
- Dua `isCode` berbeda: `util/string.ts` (dipakai `command/select.ts`, jalur mati) vs `syntax/isCode.ts` (dipakai `compile.ts`).

## Konvensi

- `.editorconfig`: LF, 4 spasi, single quote. Komentar kode campur 中文/English dari upstream; kode baru pakai English.
- Test hanya `test/non-extension/**` (jest + `jest-mock-vscode`), tidak ada extension-host test aktif.
- Jangan ubah `resources/` (salinan grammar VS Code) kecuali sengaja.
- Roadmap upstream di `CHANGELOG.md` [Unreleased]: panel independen (riwayat, banding multi-sumber, detail kata, buku kosakata), i18n lebih banyak.
