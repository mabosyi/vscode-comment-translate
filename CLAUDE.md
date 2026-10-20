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

Baseline 2026-10-20 (fresh clone, Windows): `tsc` bersih; webpack OK (1 warning `keyv` dynamic require, benign); eslint 1 error `no-control-regex` di `src/syntax/isCode.ts:35`; jest **1 fail** `commentParse.test.ts` "【typescript】" — bukan bug kode, tapi fixture ter-checkout CRLF (`core.autocrlf=true`, repo tanpa `.gitattributes`) sementara expected template-literal LF. Branch `fix/translate-source-reliability` menambah `.gitattributes` (`test/fixtures/** text eol=lf`), sehingga suite jest penuh hijau (1 test skipped).

## Peta arsitektur

```
activate() src/extension.ts
 ├─ getCanLanguageIds()      util/ext.ts      → context key commentTranslate.canLanguages
 ├─ initTranslate()          translate/manager.ts
 │    ├─ TranslateManager    (npm comment-translate-manager@0.0.5; cache workspaceState, chunk by ITranslate.maxLen)
 │    └─ TranslateExtensionProvider translate/translateExtension.ts
 │         built-in: Google | Bing | DeepL | Copilot (= LanguageModelTranslate di atas vscode.lm) | TranSmart
 │         eksternal: contributes.translates + exports.extendTranslate
 │         applySources(primary, fallbacks): 1 id atau ada id non-built-in → switchTranslate(ids[0]);
 │           semua built-in → FallbackTranslate terdaftar dengan key `chain:A>B>C` (coba anggota berurutan)
 ├─ createComment()          syntax/Comment.ts → TextMateService (vscode-textmate + oniguruma wasm) → CommentParse
 ├─ registerCommands()       command/command.ts (25 command → command/*.ts)
 ├─ registerHover()          languageFeature/hover.ts ('*' HoverProvider: komentar/seleksi + hover.content + diagnostics)
 ├─ registerCompletion()     languageFeature/completion.ts (nameVariable → change-case)
 ├─ registerChatParticipant() copilot/translate.ts (@translate, /word, /var; vscode.lm gpt-4o)
 ├─ conciseDecorationManager languageFeature/concise.ts
 ├─ registerMarkdownPreview() languageFeature/markdownPreview.ts (scheme translated-markdown://, FS+content provider)
 └─ commentDecorationManager languageFeature/decoration.ts (browse/immersive: contrast|inplace; markdown/rst/plaintext via blockParser.ts)
```

Jalur terjemahan: `compile.ts:compileBlock` → `manager.ts:autoMutualTranslate` (cld3 detect bila `mutualTranslate`) → `cachedTranslate` (session Map ≤1000 + dedupe in-flight) → `TranslateManager.translate` (workspaceState cache → `splitText` → `ITranslate.translate`; dengan `fallbackSources` terisi, `ITranslate` itu adalah `FallbackTranslate` yang mencoba anggotanya berurutan sampai ada hasil non-kosong).

Subsistem & file inti:

| Subsistem | File | Catatan |
|---|---|---|
| Syntax/TextMate | `syntax/TextMateService.ts`, `CommentParse.ts`, `Comment.ts`, `compile.ts`, `isCode.ts` | Grammar dari `extensions.all`; `resources/<lang>/` hanya dipakai saat `env.remoteName` (remote). `isCode.ts` = heuristik skor token, bukan flourite. |
| Markdown | `syntax/markdownDocument.ts` (1023 baris, parser line-oriented murni), `languageFeature/markdownPreview.ts`, `translatedMarkdownFs.ts` | Preview progresif batch 5, debounce 500 ms. Browse-mode markdown ada di `decoration.ts`, bukan di sini. |
| Hover/Browse | `languageFeature/hover.ts`, `hoverUtil.ts`, `decoration.ts`, `commentDecoration.ts`, `concise.ts`, `blockParser.ts`, `codelen.ts` | `codelen.ts` = placeholder CodeLens untuk spacing mode contrast. |
| Commands/Copilot | `command/*.ts`, `copilot/translate.ts`, `copilot/prompt.ts` | 5 command tak ada di `contributes.commands` (4 `_`-prefix untuk link hover + `toggleEnableHover`). `command/sourceSetup.ts` = `setDeepLApiKey` + `selectLanguageModel`. |
| Translate | `translate/*.ts`, `plugin/translateAli.ts`, `util/timeout.ts` | Ali di-expose lewat API ekstensi ini sendiri (`extendTranslate`). `FallbackTranslate.ts` = komposit rantai fallback; `util/timeout.ts` = `withTimeout` dipakai Bing dan sumber language model. `lineBreakFallback.ts` = `normalizeTranslatedLines`: memetakan hasil terjemahan ke baris sumber bila provider menggabung/memecah baris (dipakai `compile.ts` dan `commentDecoration.ts`); `ITranslatedText.targets` sejajar indeks dengan `texts`/`tokens`. |

Sumber terjemahan built-in (key = nilai `commentTranslate.source`):

| Key | Class | `maxLen` | Timeout request | Setting / kredensial |
|---|---|---|---|---|
| `Google` | `GoogleTranslate` | 500 | 10 s (opsi `got`) | `googleTranslate.tld`, `googleTranslate.mirror` |
| `Bing` | `BingTranslate` | 1000 | 10 s (`withTimeout`) | — |
| `DeepL` | `DeepLTranslate` | 5000 | 10 s (`AbortSignal.timeout`) | API key di SecretStorage `commentTranslate.deepl.apiKey` (command `setDeepLApiKey`), tidak ada di settings |
| `Copilot` | `LanguageModelTranslate` (semua model `vscode.lm`, bukan hanya Copilot) | 2000 | 30 s (`withTimeout` + cancel token) | `languageModel.id` (command `selectLanguageModel`; kosong = model `copilot` pertama) |
| `TranSmart` | `TranSmartTranslate` | 5000 | tidak ada | — |

Setting baru di branch ini: `commentTranslate.fallbackSources` (array id built-in, default `[]`, dicoba berurutan setelah `source` gagal) dan `commentTranslate.languageModel.id`. `maxLen` rantai = minimum `maxLen` anggota, jadi `Google` di dalam rantai memperkecil chunk semua anggota menjadi 500.

Titik perluasan:
- Sumber terjemahan built-in baru: class implement `ITranslate` (lib `comment-translate-manager`), tambah ke `buildInTranslate` di `translate/manager.ts`. Sumber built-in otomatis bisa dipakai di `fallbackSources`; sumber dari ekstensi lain tidak (rantai hanya mendukung built-in).
- Command baru: `command/command.ts` + `contributes.commands` + `package.nls*.json` (+ `menus`/`keybindings`).
- Slash command Copilot: `chatParticipants[0].commands` + `strategyRegistry.register` di `copilot/translate.ts`.
- Konstruk Markdown yang dilindungi: `parseInlineSegments` / `parseMarkdownLines` di `syntax/markdownDocument.ts`.
- Bahasa browse-mode non-TextMate: switch `languageId` di `decoration.ts` + `blockParser.ts`.

## Jebakan terverifikasi (baca sebelum ubah kode)

- CRLF sudah ditangani: `CommentParse` memecah `getText()` dengan `split(/\r?\n/)` dan `parseMarkdownLines` menormalkan `\r\n?` ke `\n` dulu, jadi `\r` tidak lagi masuk token komentar dan blok kode berpagar di Markdown CRLF tidak ikut diterjemahkan. `ICommentBlock.comment` tetap dari `TextDocument.getText(range)`, jadi di dokumen CRLF masih memuat `\r\n` asli. Kegagalan test `commentParse` di Windows berasal dari fixture CRLF, bukan dari parser (diatasi `.gitattributes`).
- `translateExtensionProvider.init()` di `manager.ts` **tidak di-await**; sampai sumber terdaftar, `translate()` reject `Translate not found.`
- Error terjemahan → lib balikin `''`. Error asli tetap tercatat di output channel lewat `_subTranslate` (`e.toString()`); baris `{}` sesudahnya cuma noise dari lib. Sejak branch `fix/translate-source-reliability`, `cachedTranslate` tidak lagi menyimpan `''` ke session cache (dulu kegagalan sesaat menempel sampai config berubah).
- `bing-translate-api` 2.x rusak terhadap Bing sekarang (`401`, terukur 0/12 pada 2026-10-20); 4.3.0 OK 12/12. Google `translate_a/single` kena `429` intermiten per client: `gtx` dan `at` (keduanya tidak resmi) dibatasi secara terpisah, dan mana yang kena berubah seiring waktu. Terukur 2026-10-20: gtx 0/10 vs at 10/10 (awal), lalu gtx 6/6 vs at 0/6 (berselang). Throttling per client kadang terjadi, tapi kedua client juga kena bersamaan (4 request, masing-masing at:429 lalu gtx:429 atau sebaliknya, ~1 s per request). Rotasi hanya membantu selama satu bucket masih bebas; kalau keduanya kena, gagal lebih cepat (~1 s, bukan ~4.5 s dengan retry bawaan `got`). `GoogleTranslate` memutar ke client berikutnya saat `429` (`GOOGLE_CLIENTS` di `src/translate/GoogleTranslate.ts`) dan retry otomatis `got` sengaja dimatikan (`retry: { limit: 0 }`) supaya pindah client langsung; itu juga menghindari stall ~33 s pada jaringan yang mati. Batas eksternal, bukan bug kode.
- `bing-translate-api` 4.x tanpa timeout request dan menyimpan promise konfigurasi global yang ditolak di state modul (`node_modules/bing-translate-api/src/index.js:246-256`): setelah satu kali gagal ambil konfigurasi, semua panggilan Bing gagal sampai extension host restart. `BingTranslate` hanya membatasi waktu (`withTimeout` 10 s), tidak bisa mereset state itu. Mitigasi: `commentTranslate.fallbackSources` atau reload window.
- Timeout: Google 10 s (`got`), Bing 10 s (`withTimeout`), DeepL 10 s (`AbortSignal.timeout`), language model 30 s (`withTimeout` membungkus kirim sampai stream habis, jadi tetap menolak walau provider mengabaikan cancellation dan teks parsial tidak pernah dikembalikan). `withTimeout` tidak membatalkan pekerjaan di baliknya; pemanggil yang bisa membatalkan (token `vscode.lm`) harus melakukannya sendiri. Request yang menggantung tanpa batas mengunci `pendingTranslateTasks` di `manager.ts` dan rantai fallback tidak pernah pindah anggota.
- Rantai fallback: hasil sukses tersimpan di `workspaceState` di bawah key rantai (`chain:A>B`), jadi pulihnya sumber utama tidak menimpa hasil anggota cadangan yang sudah tersimpan. Mengganti isi/urutan rantai membuat ruang key baru; entri lama tidak dibersihkan otomatis (tanpa kedaluwarsa), hanya lewat command `commentTranslate.clearTranslationCache` (`clearTranslationCache()` di `manager.ts`: kosongkan session cache lalu hapus semua key `workspaceState` berpola `-from[..]to[..]-`, key lain di `workspaceState` dibiarkan; cache `concise.ts` tidak ikut dan request yang sedang berjalan masih menulis hasilnya sesudahnya). `getFallbackSources()` membuang nilai non-array dan entri non-string dari settings; id yang salah ketik membuat rantai dibatalkan dan hanya `source` yang dipakai (satu baris log di output channel).
- Key DeepL dibaca dari SecretStorage pada setiap panggilan (tanpa memo) dan hanya menerima ASCII printable tanpa spasi (`validateInput` di `setDeepLApiKey`), karena undici mengulang isi header yang tidak valid di teks error, yang dicatat ke output channel.
- DeepL Free kena rate limit kalau dibanjiri: pada 2026-10-20 mode browse mengirim 575 request dan 483 gagal `429`. Karena itu `DeepLTranslate` membatasi dua request bersamaan (gerbang global, dipegang selama retry) dan mengulang `429/529/500/503/504` dua kali dengan backoff 1 s dan 2 s atau `Retry-After` (maks 5 s). `403`, `456`, dan timeout tidak diulang.
- Teks yang sudah berbahasa target tidak dikirim ke sumber mana pun: `cachedTranslate`, `autoMutualTranslate`, dan `marked.ts` memakai `isSameLanguage()` di `src/lang.ts`. Untuk target `id`, deteksi cld3 `ms` dianggap Indonesia (cld3 sering salah mengira Indonesia sebagai Melayu). Jalur Markdown/browse/preview tidak memakai `mutualTranslate`, jadi tanpa pengecekan ini dokumen Indonesia dikirim utuh dengan target `id`.
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
