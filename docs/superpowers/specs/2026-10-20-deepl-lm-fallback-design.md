# Spec: DeepL built-in, sumber vscode.lm generik, dan rantai fallback

Tanggal: 2026-10-20
Branch dasar: `fix/translate-source-reliability`
Status: disetujui user, menunggu rencana implementasi

## 1. Latar belakang

Pada 2026-10-20 user melaporkan sumber terjemahan sering gagal. Profil VS Code yang dipakai ("Embedded Systems-Zephyr") memakai `source = Bing`, `targetLanguage = id`, dan `mutualTranslate = true`. Pengukuran A/B dari jaringan yang sama:

| Sumber | Berhasil | Error |
|---|---|---|
| Bing, `bing-translate-api` 2.10.0 (versi bundel 3.1.0) | 0/12 | `401 Unauthorized` |
| Bing, `bing-translate-api` 4.3.0 | 12/12 | — |
| Google `translate_a/single` | 10/22 | `429 Too Many Requests` |

Langkah 1 (sudah dikerjakan di branch dasar) menaikkan Bing ke 4.3.0 dan menghentikan `cachedTranslate` menyimpan hasil `''`. Sebelumnya satu kegagalan sesaat menempel di session cache sampai config berubah.

Spec ini adalah langkah 2. Google dan Bing adalah scraping endpoint tidak resmi, jadi keduanya bisa rusak lagi kapan saja. Fitur ini menambah dua sumber berbasis API resmi dan rantai fallback supaya kegagalan satu sumber tidak langsung menjadi "Translate Error" di hover.

## 2. Keputusan user

| Topik | Keputusan |
|---|---|
| DeepL | Built-in, cakupan inti, tanpa glossary |
| vscode.lm | Sumber Copilot yang ada diperluas menjadi generik, ditambah command pemilih model |
| Fallback | Daftar sumber berurutan, dicoba hanya saat sumber sebelumnya gagal |
| Arsitektur fallback | Opsi A: sumber komposit yang didaftarkan sebagai satu `ITranslate` |

## 3. Kendala dari kode yang ada

Library `comment-translate-manager@0.0.5` (`node_modules/comment-translate-manager/lib/index.js`) tidak diubah. Perilaku yang menentukan desain:

- `TranslateManager` hanya memegang satu translator aktif. `registry(id, ctor)` menyimpan constructor ke Map private, dan `setSource(id)` langsung kembali bila `_source === id` (baris 37-41). `_createTranslate()` memanggil `new ctor()` tanpa argumen dan tidak pernah membuang instance lama (baris 43-49).
- `translate()` memecah teks dengan `splitText(text, translator.maxLen || 1000)` dan mengirim semua chunk paralel. Bila baris pertama lebih panjang dari `maxLen`, chunk pertama berupa `''` (baris 154-178).
- Kegagalan chunk dicatat lewat `e.toString()` ke `onTranslate`, lalu `translate()` mengembalikan `''`. Hasil sukses disimpan permanen di `workspaceState` dengan key `${_source}-from[..]to[..]-${text}`.

Di repo:

- `src/syntax/compile.ts:120-138` membuang baris kosong sebelum menerjemahkan, lalu memecah hasil per `\n` dan menyusunnya kembali ke baris komentar hanya bila jumlah barisnya sama. Kalau tidak sama, teks mentah dipakai dan penanda komentar hilang. Sumber apa pun sebaiknya menjaga jumlah baris.
- `src/translate/manager.ts:104-125` mendefinisikan sumber built-in dan memanggil `translateExtensionProvider.init()` tanpa `await`.
- `src/translate/translateExtension.ts:89-122` (`switchTranslate`) mengaktifkan ekstensi eksternal secara async sebelum `setSource`.
- Sumber mengakses VS Code lewat `import { ctx, outputChannel } from '../extension'`, karena constructor tidak menerima argumen.

## 4. Fakta API eksternal (terverifikasi dari dokumentasi resmi)

DeepL `/v2/translate`:
- Auth wajib lewat header `Authorization: DeepL-Auth-Key <key>`. Auth lewat query atau body mengembalikan `403` untuk akun Free sejak Januari 2026.
- Key yang berakhir `:fx` adalah akun Free dan memakai `https://api-free.deepl.com`. Key lain memakai `https://api.deepl.com`.
- Array `text` paling banyak 50 entri, dan body paling besar 128 KiB.
- `split_sentences` default memecah segmen pada tanda baca dan newline. Dokumentasi tidak menjamin jumlah newline output sama dengan input. Hal ini diverifikasi manual (lihat bagian 9).
- `ZH-HANS` dan `ZH-HANT` hanya bisa sebagai target. Sebagai source dipakai `ZH`. `ID` didukung.
- Source dan target yang sama, termasuk varian regional (`EN` ke `EN-US`), ditolak dengan `400`.
- Status `429` dan `529` berarti terlalu banyak request, `456` berarti kuota habis, dan `403` berarti auth gagal. Body error berbentuk `{"message": ...}`, kadang `{"error": {"message": ...}}`, kadang bukan JSON.

VS Code Language Model API:
- `lm.selectChatModels(selector)` bisa mengembalikan array kosong. Field selector `id` terdapat di `@types/vscode` 1.109, tetapi belum dipastikan ada di engine `^1.92`.
- Panggilan `sendRequest` pertama memunculkan dialog consent dan harus berasal dari aksi user. `selectChatModels` sendiri tidak memunculkan consent.
- Peran pesan hanya `User` dan `Assistant`, tidak ada system role.
- `LanguageModelChat` menyediakan `id`, `name`, `vendor`, `family`, `version`, dan `maxInputTokens`.

Extension host VS Code 1.92 berjalan di Electron 30 dengan Node 20.14, jadi global `fetch` dan `AbortSignal.timeout` tersedia.

## 5. Arsitektur

```
config: source="DeepL", fallbackSources=["Copilot","Bing"]
            │  (init saat aktivasi, listener 'source' dan 'fallbackSources')
            ▼
TranslateExtensionProvider.applySources(primary, fallbacks)
   ├─ fallbacks kosong, atau ada id non-built-in ─► switchTranslate(primary)   (perilaku saat ini)
   └─ semua built-in ─► registry("chain:DeepL>Copilot>Bing", ctor komposit) ─► setSource
                                         │
translateManager.translate(text) ──► FallbackTranslate.translate
                                         ├─ DeepL     gagal (456) → log, lanjut
                                         ├─ Copilot   sukses → hasil dikembalikan
                                         └─ Bing      tidak dipanggil
```

Semua pemanggil tetap lewat `translateManager`, jadi hover, mode browse, preview Markdown, dan command replace ikut tercakup tanpa diubah. Saat `fallbackSources` kosong, perilaku identik dengan sebelum fitur ini.

## 6. Unit

### 6.1 `src/translate/DeepLTranslate.ts` (baru)

`class DeepLTranslate extends BaseTranslate`, `maxLen = 5000`.

- Input kosong atau hanya whitespace langsung mengembalikan `''` tanpa request.
- Key dibaca dengan `await ctx.secrets.get('commentTranslate.deepl.apiKey')` pada setiap panggilan, tanpa memo dan tanpa listener. Bila key tidak ada, melempar `Error('DeepL API key is not set. Run "Comment Translate: Set DeepL API Key".')`.
- Endpoint dipilih dari sufiks `:fx`.
- Body JSON `{ text: [content], target_lang, source_lang? }`. Teks dikirim sebagai satu string, tanpa pemecahan per baris dan tanpa `context`, sama seperti referensi `yxw007/translate`.
- Mapping target: `zh-CN` ke `ZH-HANS`, `zh-TW` ke `ZH-HANT`, `en` ke `EN-US`, `pt` ke `PT-BR`, lainnya upper-case. Mapping `en` dan `pt` adalah pilihan desain, bukan kewajiban yang terdokumentasi.
- Mapping source: `auto` tidak dikirim, `zh-CN` dan `zh-TW` menjadi `ZH`, lainnya upper-case kode dasar. `source_lang` juga tidak dikirim bila kode dasarnya sama dengan kode dasar target, untuk menghindari `400`.
- `fetch` dengan `AbortSignal.timeout(10000)`. Tidak ada retry: kegagalan ditangani rantai fallback, dan karena hasil `''` tidak di-cache, hover berikutnya otomatis mencoba lagi.
- Non-2xx melempar `Error(\`DeepL ${status}: ${message}\`)`. `message` dibaca dari `body.message ?? body.error?.message`, atau `statusText` bila body bukan JSON.
- `link()` menghasilkan `[DeepL](https://www.deepl.com/translator#auto/<to>/<encoded text>)`.

### 6.2 Command `commentTranslate.setDeepLApiKey` (baru)

`window.showInputBox({ password: true, ignoreFocusOut: true })`. Nilai non-kosong disimpan dengan `ctx.secrets.store`, input kosong menghapus key dengan `ctx.secrets.delete`, dan Esc tidak mengubah apa pun. Key milik ekstensi lain seperti `Translate-next.deepl.key` tidak dibaca otomatis.

### 6.3 `src/translate/LanguageModelTranslate.ts` (menggantikan `CopilotTranslate.ts`)

Key sumber built-in tetap `Copilot`, jadi setting `commentTranslate.source = "Copilot"` yang sudah ada tetap jalan. Judulnya menjadi "VS Code Language Model (Copilot, ...)". `maxLen = 2000`.

- Input kosong langsung mengembalikan `''`.
- Model dipilih dengan `lm.selectChatModels()` tanpa selector, lalu difilter di sisi ekstensi dengan `m.id === languageModel.id`. Bila setting kosong, dipakai model pertama dengan `vendor === 'copilot'`. Bila tidak ada model, melempar error yang menyuruh user menjalankan "Comment Translate: Select Language Model".
- `LanguageModelError` dengan code `NoPermissions` diterjemahkan menjadi pesan yang sama, karena consent belum diberikan.
- Prompt dibuat oleh fungsi murni `buildTranslatePrompt(text, to)` yang diekspor untuk test. Nama bahasa diambil dari `new Map(LANGS).get(to) ?? to` (`src/lang.ts`). Instruksinya: terjemahkan komentar source code untuk engineer firmware ke bahasa tujuan; keluarkan tepat N baris dengan baris ke-i menerjemahkan baris input ke-i; jangan ubah identifier, nama register atau macro, angka hex, path, dan kode dalam backtick; keluarkan terjemahannya saja. N dihitung dari input.
- Dikirim sebagai satu `LanguageModelChatMessage.User`, dengan `CancellationTokenSource` yang dibatalkan setelah 30 detik. Fragmen hasil digabung lalu newline di akhir dipangkas.
- `link()` mengembalikan `''`.

### 6.4 Command `commentTranslate.selectLanguageModel` (baru)

1. `lm.selectChatModels()` mengambil semua model. Bila kosong, tampilkan pesan bahwa tidak ada model terdaftar.
2. QuickPick menampilkan `name` sebagai label, `vendor/family` sebagai deskripsi, dan `maxInputTokens` sebagai detail.
3. Model terpilih menerima satu terjemahan uji kecil ke `targetLanguage` di bawah `window.withProgress`. Panggilan ini terjadi dari aksi user, sehingga dialog consent muncul di sini, bukan saat hover.
4. Bila uji berhasil, `languageModel.id` ditulis ke konfigurasi Global dan hasil uji ditampilkan. Bila gagal, error ditampilkan dan setting tidak diubah.

### 6.5 `src/translate/FallbackTranslate.ts` (baru)

`createFallbackTranslate(members: { id: string, ctor: new () => ITranslate }[])` mengembalikan constructor tanpa argumen sehingga bisa didaftarkan ke `TranslateManager`. Instance-nya:

- membuat semua anggota secara eager di constructor;
- `maxLen` = minimum `maxLen` anggota, dengan default 1000 untuk anggota yang tidak mendefinisikannya;
- `translate(text, opts)`: input kosong langsung `''`. Anggota dicoba berurutan. Anggota yang melempar error, atau mengembalikan `''` untuk input non-kosong, dicatat ke `outputChannel` sebagai `[fallback] <id> failed: <pesan>; trying <id berikutnya>`, lalu anggota berikutnya dicoba. Hasil non-kosong pertama dikembalikan. Bila semua gagal, error terakhir dilempar, atau `Error('All fallback sources returned empty results')` bila tidak ada yang melempar;
- `link()` mendelegasikan ke anggota pertama.

### 6.6 Wiring

`src/translate/translateExtension.ts`, method baru `applySources(primary: string, fallbacks: string[])`:

1. `ids = dedupe([primary, ...fallbacks])` dengan string kosong dibuang.
2. Bila `ids.length === 1`, atau ada id yang tidak ditemukan sebagai built-in di `_translateConfig` (extensionId `'BuildIn'` dengan `ctor`), panggil `switchTranslate(primary)` seperti sekarang. Untuk kasus id non-built-in, tulis satu baris log bahwa `fallbackSources` v1 hanya mendukung sumber built-in.
3. Selain itu, daftarkan `createFallbackTranslate(members)` dengan key `chain:${ids.join('>')}` lalu `setSource(key)`. Jalur ini sinkron, jadi tidak ada race dengan aktivasi ekstensi. Key berubah setiap kali urutan berubah, sehingga `setSource` selalu membuat instance baru.

`applySources` mengembalikan translator aktif yang dihasilkan `setSource` atau `switchTranslate`, atau nilai falsy bila tidak ada sumber yang bisa dipasang. `init(source)` memanggil `applySources(source, getConfig('fallbackSources', []))` dan, bila hasilnya falsy, tetap jatuh ke `switchTranslate('Google')` seperti sekarang.

`src/translate/manager.ts`:
- tambah `{ title: 'DeepL translate', ctor: DeepLTranslate, translate: 'DeepL' }` ke `buildInTranslate`;
- ganti `CopilotTranslate` dengan `LanguageModelTranslate`;
- listener `source` dan `fallbackSources` membersihkan session cache lalu memanggil `applySources`. Dengan begitu edit manual `settings.json` juga ikut berpindah sumber. Command `changeTranslateSource` memanggil `applySources(target, fallbackSources)` alih-alih `switchTranslate`. Memilih ulang sumber yang sama tidak memicu event konfigurasi, jadi tanpa perubahan ini rantai fallback akan diganti sumber tunggal sampai reload.
- listener `languageModel.id` membersihkan session cache.

`src/command/command.ts` mendaftarkan dua command baru. `package.json` mendapat:

| Kontribusi | Nilai |
|---|---|
| `commentTranslate.fallbackSources` | `array` of `string`, default `[]`. Deskripsi menyarankan rantai tanpa Google, karena `maxLen` Google 500 memperkecil chunk semua anggota. |
| `commentTranslate.languageModel.id` | `string`, default `""`, diisi oleh command pemilih model |
| `commentTranslate.setDeepLApiKey` | command, judul "Set DeepL API Key" |
| `commentTranslate.selectLanguageModel` | command, judul "Select Language Model" |

String NLS ditambahkan ke `package.nls.json`. Locale lain otomatis jatuh ke bahasa Inggris.

## 7. Trade-off yang diterima

Masing-masing ditandai komentar `ponytail:` di kode:

- Hasil fallback tersimpan permanen di `workspaceState` di bawah key rantai. Bila DeepL pulih, komentar yang sempat diterjemahkan Bing tetap memakai hasil Bing. Command clear-cache ditambah bila ini mengganggu.
- Mengganti urutan rantai membuat ruang key `workspaceState` baru, dan entri lama tidak pernah dibersihkan.
- `maxLen` minimum membuat Google di dalam rantai memperkecil chunk ke 500 karakter. Karena chunk dikirim paralel, request ke DeepL ikut bertambah.
- Mengganti `languageModel.id` hanya membersihkan session cache. Terjemahan lama di `workspaceState` di bawah key `Copilot` tetap dipakai.

## 8. Di luar cakupan

- Glossary, formality, dan `preserve_formatting` DeepL.
- Model hardcode `gpt-4o` di chat participant `@translate` (`src/copilot/translate.ts`).
- Sumber eksternal (ekstensi marketplace) di dalam rantai fallback.
- Race `init()` tanpa `await` yang sudah ada sebelumnya.
- Impor otomatis key DeepL dari ekstensi lain.

## 9. Testing

Unit test jest di `test/non-extension/translate/`. Mock yang dibutuhkan, karena `jest-mock-vscode` tidak mengimplementasikan `lm`, `LanguageModelChatMessage`, `LanguageModelError`, `CancellationTokenSource`, `extensions`, dan `env`:
- `jest.mock('../../../src/extension', () => ({ ctx: { secrets: ... }, outputChannel: { append, appendLine } }))`;
- `global.fetch` diganti `jest.fn()`;
- factory `jest.mock('vscode', ...)` yang menambah `lm` dan kelas-kelas di atas.

| Unit | Kasus |
|---|---|
| DeepL | endpoint Free untuk key `:fx` dan Pro untuk key lain; header auth; mapping `zh-CN`, `zh-TW`, `en`, `id`; `auto` tidak mengirim `source_lang`; source sama dengan target tidak mengirim `source_lang`; input kosong tanpa `fetch`; key hilang melempar error; non-2xx melempar error dengan status dan pesan |
| Language Model | `buildTranslatePrompt` memakai nama bahasa dan jumlah baris yang benar; tanpa model melempar error; filter `id` memilih model yang tepat |
| Fallback | anggota pertama melempar error lalu anggota kedua dipakai; `''` lalu anggota berikutnya; semua gagal melempar error terakhir; `maxLen` minimum; input kosong tidak memanggil anggota |
| Wiring | `applySources` dengan fallback kosong memanggil `switchTranslate`; dengan id non-built-in memakai jalur lama; dengan semua built-in mendaftarkan key `chain:` |

Verifikasi manual oleh user, dengan VSIX terpasang di profil "Embedded Systems-Zephyr":
1. Set key DeepL lewat command, lalu hover komentar Mandarin multi-baris. Cek apakah jumlah baris output DeepL sama dengan input. Fakta ini belum terdokumentasi.
2. Jalankan "Select Language Model" dan pastikan dialog consent muncul di situ.
3. Isi `fallbackSources` dengan `["Copilot", "Bing"]`, kosongkan key DeepL, lalu pastikan hover tetap diterjemahkan dan output channel mencatat baris `[fallback]`.
