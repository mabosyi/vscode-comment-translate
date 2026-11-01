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
| Markdown | `syntax/markdownDocument.ts` (~1100 baris, parser line-oriented murni), `languageFeature/markdownPreview.ts`, `translatedMarkdownFs.ts` | Preview progresif batch 5, debounce 500 ms; hasil batch dipetakan balik oleh `translatePieces`. Browse-mode markdown ada di `decoration.ts`, bukan di sini. |
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
- `bing-translate-api` 2.x rusak terhadap Bing sekarang (`401`, terukur 0/12 pada 2026-10-20); 4.3.0 OK 12/12. Google `translate_a/single` kena `429` intermiten per client: `gtx` dan `at` (keduanya tidak resmi) dibatasi secara terpisah, dan mana yang kena berubah seiring waktu. Terukur 2026-10-20: gtx 0/10 vs at 10/10 (awal), lalu gtx 6/6 vs at 0/6 (berselang). Throttling per client kadang terjadi, tapi kedua client juga kena bersamaan (4 request, masing-masing at:429 lalu gtx:429 atau sebaliknya, ~1 s per request). Rotasi hanya membantu selama satu bucket masih bebas; kalau keduanya kena, gagal lebih cepat (~1 s, bukan ~4.5 s dengan retry bawaan `got`). `GoogleTranslate` memutar ke client berikutnya saat `429` (`GOOGLE_CLIENTS` di `src/translate/GoogleTranslate.ts`) dan retry otomatis `got` sengaja dimatikan (`retry: { limit: 0 }`) supaya pindah client langsung. Itu juga menghindari stall pada jaringan yang mati: dari default `got` 12 (3 percobaan × timeout 10 s + backoff 1 s + 2 s) request yang timeout bisa menahan sampai ~33 s; angka ini hasil hitung dari default, bukan hasil ukur. Batas eksternal, bukan bug kode.
- `bing-translate-api` 4.x tanpa timeout request dan menyimpan promise konfigurasi global yang ditolak di state modul (`node_modules/bing-translate-api/src/index.js:246-256`): setelah satu kali gagal ambil konfigurasi, semua panggilan Bing gagal sampai extension host restart. `BingTranslate` hanya membatasi waktu (`withTimeout` 10 s), tidak bisa mereset state itu. Mitigasi: `commentTranslate.fallbackSources` atau reload window.
- Timeout: Google 10 s (`got`), Bing 10 s (`withTimeout`), DeepL 10 s (`AbortSignal.timeout`), language model 30 s (`withTimeout` membungkus kirim sampai stream habis, jadi tetap menolak walau provider mengabaikan cancellation dan teks parsial tidak pernah dikembalikan). `withTimeout` tidak membatalkan pekerjaan di baliknya; pemanggil yang bisa membatalkan (token `vscode.lm`) harus melakukannya sendiri. Request yang menggantung tanpa batas mengunci `pendingTranslateTasks` di `manager.ts` dan rantai fallback tidak pernah pindah anggota.
- Rantai fallback: hasil sukses tersimpan di `workspaceState` di bawah key rantai (`chain:A>B`), jadi pulihnya sumber utama tidak menimpa hasil anggota cadangan yang sudah tersimpan. Mengganti isi/urutan rantai membuat ruang key baru; entri lama tidak dibersihkan otomatis (tanpa kedaluwarsa), hanya lewat command `commentTranslate.clearTranslationCache` (`clearTranslationCache()` di `manager.ts`: kosongkan session cache lalu hapus semua key `workspaceState` berpola `-from[..]to[..]-`, key lain di `workspaceState` dibiarkan). Handler command lalu memanggil `commentDecorationManager.resetCommentDecoration()` (browse mode memakai ulang `CommentDecoration` selama range dan teks komentar tidak berubah), `conciseDecorationManager.clearCache()`, dan `refreshTranslatedMarkdownPreviews()` di `markdownPreview.ts`. Fungsi terakhir memanggil `TranslatedMarkdownProvider.invalidateAll()`, yang membuang snapshot semua preview, termasuk preview yang dokumennya sudah ditutup, lalu menerjemahkan ulang preview yang masih terbuka. Handler `onDidChangeConfiguration` untuk `targetLanguage`/`source` memakai fungsi yang sama. Yang tersisa: request terjemahan yang sedang berjalan masih menulis hasilnya ke session cache dan `workspaceState` sesudah cache dikosongkan. `getFallbackSources()` membuang nilai non-array dan entri non-string dari settings; id yang salah ketik membuat rantai dibatalkan dan hanya `source` yang dipakai (satu baris log di output channel).
- Key DeepL dibaca dari SecretStorage pada setiap panggilan (tanpa memo) dan hanya menerima ASCII printable tanpa spasi (`validateInput` di `setDeepLApiKey`), karena undici mengulang isi header yang tidak valid di teks error, yang dicatat ke output channel.
- DeepL Free kena rate limit kalau dibanjiri: pada 2026-10-20 mode browse mengirim 575 request dan 483 gagal `429`. Karena itu `DeepLTranslate` membatasi dua request bersamaan (gerbang global, dipegang selama retry) dan mengulang `429/529/500/503/504` dua kali dengan backoff 1 s dan 2 s atau `Retry-After` (maks 5 s). `403`, `456`, dan timeout tidak diulang.
- Teks yang sudah berbahasa target tidak dikirim ke sumber mana pun: `cachedTranslate`, `autoMutualTranslate`, dan `marked.ts` memakai `isSameLanguage()` di `src/lang.ts`. Fungsi itu mencocokkan kode yang sama persis atau kode dasar yang diikuti `-` (`zh` cocok dengan `zh-TW`, `ha` tidak cocok dengan `haw`), dan untuk target `id` deteksi cld3 `ms` dianggap Indonesia (cld3 sering salah mengira Indonesia sebagai Melayu). Jalur Markdown/browse/preview tidak memakai `mutualTranslate`, jadi tanpa pengecekan ini dokumen Indonesia dikirim utuh dengan target `id`.
  - cld3 sering salah pada teks Latin pendek (`Main loop` dan `Set baud rate` terbaca `id`). Karena itu `cachedTranslate` dan `autoMutualTranslate` hanya memercayai vonis "sudah bahasa target" untuk teks yang mengandung CJK atau yang panjangnya minimal 30 karakter setelah spasi dirapatkan (`isDetectionReliable` di `manager.ts`); teks Latin yang lebih pendek tidak dideteksi sama sekali. Terukur 2026-11-01 pada 64.328 unit komentar Inggris (tree zephyr) dan 16.176 unit teks Indonesia (catatan Markdown user): tanpa batas, 358 komentar Inggris salah di-skip; dengan batas 30 tinggal 157, sementara 95,1% karakter teks Indonesia tetap di-skip (95,9% tanpa batas). Akibatnya teks Indonesia pendek tetap dikirim dengan target `id` (kembali apa adanya), dan dengan `mutualTranslate` tidak lagi dibalik ke bahasa sumber.
  - `marked.ts` (hover file Markdown, konten hover dari provider lain, pesan diagnostics) tetap memeriksa per baris tanpa batas panjang. Baris berbahasa target, termasuk link title, dibuang dari batch, lalu sisanya dikirim langsung ke `translateManager.translate`. Batas panjang sengaja tidak dipakai di sini: pada baris di bawah 30 karakter, 59,6–81,0% baris Indonesia dikenali benar dan hanya 1,0–1,7% baris Inggris salah dikenali, jadi batas itu akan mengirim jauh lebih banyak baris Indonesia daripada baris Inggris yang terselamatkan. Batch juga sengaja tidak lewat `cachedTranslate`, karena cld3 bisa membaca gabungan baris yang masing-masing lolos (mis. `Status code` / `Callback function` / `Clock source`, per baris sn/ja/nl) sebagai `id`. Dulu batch hover selalu berisi semua baris, jadi satu baris asing ikut mengirim seluruh teks Indonesia (terukur di log output channel profil Zephyr: 15 dari 245 request, 27–30 Okt 2026).
- Tidak ada `deactivate()`; banyak `onDidChangeConfiguration` tak di-dispose (`configuration.ts`, `manager.ts`, `translateAli.ts` per instance).
- `Comment.ts` cache per dokumen hanya dibersihkan `onDidChangeTextDocument`, tidak pada close.
- `markdownDocument.ts` pakai Map modul-level (`lineInlineSegments`, `tableRowCellSegments`) yang di-reset tiap parse → race bila 2 preview paralel.
- Tabel di preview Markdown: setiap sel mengirim satu baris per potongan teks (sel ``Set `reg` now`` mengirim dua), dan `lineCount` per sel mencatat jatahnya supaya `reconstructTableRow` mengembalikan tepat baris milik sel itu; sel kosong atau tanpa teks tidak mengirim baris. Dulu hasilnya dibagikan satu baris per sel, sehingga sel berikutnya menerima potongan sel sebelumnya (terukur 2026-11-01: 13.120 dari 35.899 baris tabel di catatan user punya sel seperti itu). Sel hanya dipecah di pipe yang tidak di-escape (`\|` adalah pipe literal di GFM), dan baris yang pipe penutupnya di-escape diperlakukan sebagai baris biasa.
- Hasil batch preview yang jumlah barisnya berbeda (13 dari 194 request multi-baris di log 27–30 Okt, 12 di antaranya lebih sedikit) dulu ditambal atau dipotong, sehingga sisa batch bergeser dan entri terakhir kosong. Sekarang `translatePieces` menerjemahkan ulang entri satu per satu, lalu baris satu per satu untuk entri multi-baris yang masih meleset (termasuk entri yang sendirian di request-nya); baris yang diterjemahkan sendiri mendapat kembali spasi di sekitar inline code. Hasil satu-untuk-satu dipakai persis seperti dikembalikan, dan hasil kosong (sumber gagal) tidak diulang. Biaya: request tambahan hanya untuk hasil yang meleset, terburuk 21 request untuk batch 5 baris tabel tiga-potongan yang selalu digabung, mengantre di dua slot DeepL. 
- Terjemahan gagal (`''` dari sumber) di preview dan hover Markdown: baris dan potongan yang hasilnya kosong menampilkan teks sumbernya (`reconstructDocument`, `buildProgressiveSnapshot`, `reconstructInlineContent`, `marked.ts`), dan entri yang punya satu baris kosong tidak disimpan di `resultsMap`, jadi render berikutnya mencoba lagi. Dulu baris itu kosong dan kegagalannya dipakai ulang. Akibatnya entri yang gagal sebagian ikut diminta ulang seluruhnya (desain, hanya biaya request). Hover file `.md` tidak muncul kalau `hasTranslated` bernilai `false` (gagal total, atau baris sudah berbahasa target), sama seperti jalur hover.content dan diagnostics.
- Teks link: code span, HTML, dan penanda tebal/miring di dalam `[...]` tetap utuh. `parseInlineSegments` menelusuri token link hanya kalau ada markup, raw-nya pas sama dengan teks, dan tidak ada escape backslash (potongan `\|` sendirian bisa kembali tanpa backslash dan memecah sel tabel); selain itu teks link dikirim sebagai satu potongan. Masih tersisa: link di dalam teks tebal/miring (`**lihat [x](url)**`) dikirim utuh bersama URL-nya, karena cabang strong/em mengirim seluruh isi sebagai satu potongan.
- `package.json` `maxTranslationLength` type `number` tapi default string `"10000"`.
- Dua `isCode` berbeda: `util/string.ts` (dipakai `command/select.ts`, jalur mati) vs `syntax/isCode.ts` (dipakai `compile.ts`).

## Konvensi

- `.editorconfig`: LF, 4 spasi, single quote. Komentar kode campur 中文/English dari upstream; kode baru pakai English.
- Test hanya `test/non-extension/**` (jest + `jest-mock-vscode`), tidak ada extension-host test aktif.
- Jangan ubah `resources/` (salinan grammar VS Code) kecuali sengaja.
- Roadmap upstream di `CHANGELOG.md` [Unreleased]: panel independen (riwayat, banding multi-sumber, detail kata, buku kosakata), i18n lebih banyak.
