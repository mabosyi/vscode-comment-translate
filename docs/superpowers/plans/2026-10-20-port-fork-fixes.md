# Port temuan fork dan upstream — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memperbaiki enam bug yang ditemukan lewat riset fork dan upstream (semuanya terkonfirmasi masih ada di `master` 60dc19a), ditambah tiga perbaikan kecil yang dipilih user.

**Architecture:** Setiap task berdiri sendiri, menyentuh sesedikit mungkin file, dan selesai dengan satu commit. Kode yang diambil dari fork ditulis ulang agar sesuai struktur kita, dengan atribusi di komentar header.

**Tech Stack:** TypeScript 5.9, VS Code API `^1.92.0`, jest 29 + ts-jest + jest-mock-vscode, webpack 5.

**Riset sumber:** memory `project-fork-research`, laporan agen 2026-10-20 (fork xyy0411, SamhandsomeLee, DravenTJU, j4rviscmd, paulengineer; upstream PR #314, #316, issue #309, #310).

## Global Constraints

- Branch kerja: `feat/port-fork-fixes`. Shell: Git Bash di Windows; file working tree CRLF (`core.autocrlf=true`), pakai Edit tool.
- `engines.vscode` tetap `^1.92.0`. Tidak ada dependensi npm baru. Library `comment-translate-manager` tidak diubah.
- Komentar dan identifier kode dalam bahasa Inggris. Setiap file baru diawali komentar header singkat. Kode yang diadaptasi dari fork menyebut sumbernya di header (mis. "Adapted from xyy0411/vscode-comment-translate (MIT)").
- Shortcut yang sengaja dibatasi ditandai komentar `ponytail:` yang menyebut batas dan jalan upgrade.
- TDD: tulis test dulu, lihat gagal karena alasan yang benar, baru implementasi. Test di `test/non-extension/**`. Jalankan `npx jest --coverage=false <path>`; suite penuh `npx jest --coverage=false --silent` harus tanpa FAIL sebelum commit; `npx tsc -p ./ --noEmit` tanpa output; `npm run lint` hanya boleh menyisakan error lama `no-control-regex` di `src/syntax/isCode.ts:35`.
- Catatan: `tsconfig.json` hanya mencakup `src/`, jadi tipe di file test diperiksa oleh ts-jest saat test dijalankan.
- Setting baru: kontribusi di `package.json`, string di `package.nls.json` saja (locale lain jatuh ke bahasa Inggris per key).
- Setiap task menambah satu butir di `CHANGELOG.md` bagian `## [Unreleased]` → `### Fixed` (bug) atau `### Added` (fitur), dan memperbarui `CLAUDE.md` bila task mengubah fakta yang tercatat di sana.
- Pesan commit Conventional Commits tanpa baris atribusi.

---

### Task 1: Pertahankan jumlah baris saat sumber menggabung baris

**Bug (terkonfirmasi):** Bing, Google, dan TranSmart bisa mengembalikan terjemahan dengan jumlah baris berbeda dari komentar asli (terukur: Bing menggabung kalimat 3 baris jadi 1).
- `src/syntax/compile.ts` sekitar baris 137-138 hanya menyusun ulang bila `validTexts.length === targets.length`; selain itu teks mentah dipakai dan penanda komentar (`*`, `//`, `"""`) hilang. Diduga akar upstream issue #303 dan #308.
- `src/languageFeature/commentDecoration.ts:139` membaca `targets[targetIndex++]`; bila hasil tergabung, baris 2 dan seterusnya `undefined` sehingga mode immersive tidak menampilkan apa pun. Jalur fallback (`:91-100`) dan Markdown (`_normalizeTargets`, `:322-331`) menumpuk semua teks di baris pertama.

**Desain (adaptasi fork xyy0411 commit 2e6833f, `src/translate/lineBreakFallback.ts`):**
- Buat `src/translate/lineBreakFallback.ts` berisi `export function normalizeTranslatedLines(sourceLines: string[], translatedText: string): string[]` yang selalu mengembalikan array sepanjang `sourceLines.length`:
  1. Bila jumlah baris non-kosong sumber > 0 dan jumlah baris terjemahan sama dengan jumlah baris non-kosong sumber, sisipkan kembali baris kosong di posisi baris kosong sumber. Kasus ini diperiksa **pertama** (perbaikan false positive yang ditemukan reviewer: sumber `['a','','b','c']` dengan terjemahan 3 baris).
  2. Bila jumlah baris terjemahan sama dengan `sourceLines.length`, kembalikan apa adanya.
  3. Selain itu: ratakan semua baris terjemahan dengan spasi, lalu bagi ke N potongan sebanding panjang setiap baris sumber (baris kosong sumber → potongan kosong). Titik potong mundur ke tanda jeda terdekat (spasi atau `，。！？；：、,.!?;:`) bila ada; panjang target baris default `80` sebagai konstanta (tanpa setting).
- Tidak memakai codelen dan tidak menambah setting (fork menambah `translationFallback.enabled/lineLength`; dilewati).
- Pakai helper ini di `compile.ts` (ganti pemecahan ad-hoc sehingga penyusunan ulang per token selalu terjadi) dan di ketiga jalur `commentDecoration.ts` (ganti `targets[targetIndex++]` menjadi indeks yang sejajar token, ganti `_normalizeTargets` dan jalur fallback dengan helper).
- Perbarui komentar di `src/translate/LanguageModelTranslate.ts` sekitar baris 18-19 ("compile.ts re-aligns ... only when the line count matches") agar sesuai perilaku baru.

**Test** (`test/non-extension/translate/lineBreakFallback.test.ts`): jumlah sama → apa adanya; 3 baris sumber dan 1 baris terjemahan (gaya Bing, Inggris dan Indonesia) → 3 baris, tiap baris tidak kosong, gabungannya sama dengan teks asal (modulo spasi); sumber dengan baris kosong dan terjemahan sejumlah baris non-kosong → baris kosong disisipkan di posisi yang benar; kasus false-positive `['a','','b','c']` + 3 baris terjemahan; terjemahan lebih banyak baris dari sumber → tidak ada teks yang hilang. Tambahkan satu test `compileBlock` bila bisa dilakukan dengan mock yang sudah ada di repo; kalau tidak praktis, jelaskan di laporan.

**Commit:** `fix: keep comment line structure when a source merges or splits lines`

---

### Task 2: Command menulis setting ke profil pengguna, bukan workspace

**Bug (terkonfirmasi 2026-10-20):** `src/command/changeTargetLanguage.ts` memanggil `configuration.update(key, value)` tanpa `ConfigurationTarget` di lima tempat (`targetLanguage` :12, `source` :22, `multiLineMerge` :36, `hover.enabled` :42, `browse.mode` :54). Dengan folder terbuka, VS Code menulis ke setting **workspace**; user memilih DeepL lewat command tetapi setting profil tetap `Bing`. Tanpa folder terbuka, `update` tanpa target melempar error. Perbaikan fork SamhandsomeLee tidak tepat (tetap Workspace bila folder terbuka).

**Desain:**
- Tambah helper di `src/configuration.ts`: `export async function updateUserSetting(key: string, value: unknown): Promise<void>`. Ia membaca `getConfiguration().inspect(key)`, menulis `ConfigurationTarget.Global`, lalu bila `workspaceValue !== undefined` juga menghapusnya (`update(key, undefined, ConfigurationTarget.Workspace)`), supaya nilai baru tidak tertutup nilai workspace lama. `Global` menulis ke setting profil VS Code yang aktif.
- Ganti kelima pemanggilan dengan helper ini. `sourceSetup.ts:66` sudah memakai Global; biarkan.
- Jangan ubah listener di `manager.ts`.

**Test** (`test/non-extension/configuration.test.ts` atau di folder yang sesuai): mock `vscode.workspace.getConfiguration` → objek dengan `inspect` dan `update` (jest.fn). Kasus: tanpa nilai workspace → hanya satu `update(key, value, Global)`; dengan `workspaceValue` → `update(key, value, Global)` lalu `update(key, undefined, Workspace)`. Perhatikan `src/configuration.ts` mengimpor `src/translate/manager.ts` (yang memuat `got` ESM); mock modul-modul berat seperti yang dilakukan `test/non-extension/translate/manager.test.ts`.

**Commit:** `fix: save setting changes from commands to the user profile, not the workspace`

---

### Task 3: Command untuk menghapus cache terjemahan

**Bug (upstream issue #310, terkonfirmasi):** `comment-translate-manager` menyimpan hasil sukses di `context.workspaceState` dengan key `${source}-from[${from}]to[${to}]-${text}` (`node_modules/comment-translate-manager/lib/index.js` sekitar :110-126) tanpa kedaluwarsa dan tanpa cara menghapus. Akibatnya hasil anggota fallback (key `chain:...`) dan hasil model Language Model lama menempel permanen (lihat komentar `ponytail:` di `src/translate/manager.ts` dan `src/translate/FallbackTranslate.ts`).

**Desain:**
- Di `src/translate/manager.ts` tambah `export async function clearTranslationCache(): Promise<number>`: bersihkan `sessionTranslateCache`, lalu hapus setiap key `workspaceState` yang cocok dengan pola key library (`/-from\[[^\]]*\]to\[[^\]]*\]-/`) lewat `update(key, undefined)`; kembalikan jumlah key yang dihapus. Simpan referensi `context.workspaceState` dari `initTranslate`.
- Command `commentTranslate.clearTranslationCache` (judul NLS "Clear Translation Cache", kategori "Comment Translate") di `src/command/command.ts`, handler menampilkan `Cleared N cached translations. Reopen open previews to refresh them.`
- Perbarui komentar `ponytail:` yang menyebut "add a clear-cache command" agar menunjuk command ini.
- Cache terpisah milik `concise.ts` tidak termasuk (mode concise default mati); catat sebagai `ponytail:` bila relevan.

**Test** (di `test/non-extension/translate/manager.test.ts`): workspaceState palsu berisi key library (termasuk `chain:DeepL>Bing-from[auto]to[id]-x`) dan key lain milik ekstensi → setelah clear, hanya key library yang terhapus, angka yang dikembalikan benar, dan session cache kosong (panggilan berikutnya memanggil translate lagi).

**Commit:** `feat: add a command to clear cached translations`

---

### Task 4: CRLF tidak merusak Markdown preview dan parser komentar

**Bug (upstream PR #316 / issue #315, terkonfirmasi):** `src/syntax/markdownDocument.ts:449` `source.split('\n')` menyisakan `\r`; regex pembuka fence (`FENCED_CODE_OPEN_RE`, sekitar :124) memakai `.*$` yang tidak cocok dengan `\r`, sehingga blok kode pada file CRLF ikut diterjemahkan. Repro reviewer: ``"a\r\n```c\r\nint x;\r\n```\r\nb"`` → kelima baris translatable.
- `src/syntax/CommentParse.ts:88` juga `getText().split('\n')`; `\r` masuk token komentar (dampak kosmetik karena di-`trim()`).

**Desain:** `source.replace(/\r\n?/g, '\n').split('\n')` di `markdownDocument.ts:449`; `split(/\r?\n/)` di `CommentParse.ts:88` (posisi VS Code tidak pernah menghitung EOL).

**Test:** di `test/non-extension/syntax/markdownDocument.test.ts`, dokumen CRLF dengan blok kode → baris kode tidak translatable dan hasil sama dengan versi LF. Untuk CommentParse, tambahkan test bila bisa memakai pola `test/non-extension/syntax/comment.test.ts` / `mocks.ts` dengan dokumen CRLF; kalau tidak praktis, jelaskan di laporan.

**Commit:** `fix: handle CRLF line endings in Markdown preview and comment parsing`

---

### Task 5: Markdown preview tidak merusak URL dan teks berisi `$`

**Bug (upstream issue #309, terkonfirmasi):** `reconstructInlineContent` (`src/syntax/markdownDocument.ts` sekitar :321-334) memakai `result = result.replace(segment.raw, translatedPart)`:
- (a) mengganti kemunculan **pertama**, sehingga segmen pendek seperti `:` atau `.` mengenai karakter di dalam `href` yang mestinya tidak diterjemahkan;
- (b) string pengganti menafsirkan `$&`, `$'`, `` $` ``, `$$`.

**Desain:** ganti dengan penyusunan berurutan memakai kursor: untuk setiap segmen sesuai urutan (translatable maupun tidak), cari `seg.raw` mulai dari kursor (`indexOf(raw, cursor)`), salin bagian sebelum, tulis teks pengganti (terjemahan untuk segmen translatable, raw untuk yang tidak) lewat `slice`/konkatenasi (bukan `String.replace`), lalu majukan kursor. Semua pemanggil (sekitar :424, :710, :718, :878, :884) lewat fungsi ini. Jangan memakai `segments.map().join('')` karena segmen link membangun ulang `urlSuffix` dari href/title.

**Test:** baris dengan link yang href-nya mengandung `:` dan teks bertitik dua di luar link → href utuh; terjemahan yang mengandung `$&` dan `$'` → muncul literal, tanpa duplikasi.

**Commit:** `fix: stop Markdown preview from corrupting links and $ sequences`

---

### Task 6: Google memakai `client=at`

**Bukti (2026-10-20, mesin user):** `translate_a/single` dengan parameter ekstensi, 10 request bergantian per client: `client=gtx` 0/10 (semua 429), `client=at` 10/10 (200), bentuk `res[0]` sama sehingga parser di `src/translate/GoogleTranslate.ts:42-52` tidak berubah. Sumber: upstream PR #314 (ditutup penulisnya tanpa review).

**Desain:** ganti `client: 'gtx'` (`src/translate/GoogleTranslate.ts:29`) menjadi konstanta `GOOGLE_CLIENT = 'at'` dengan komentar `ponytail:` (parameter tidak resmi, bisa diblokir Google sewaktu-waktu; jalan upgrade: setting `googleTranslate.client` atau rotasi client saat 429). Tidak menambah setting.

**Test:** tidak ada test unit Google saat ini (bergantung `got` ESM). Cukup verifikasi live satu kali dengan skrip sementara di luar repo yang memanggil endpoint dengan `client=at` dan melaporkan status; catat hasilnya di laporan.

**Commit:** `fix: use the Google 'at' client to avoid the throttled gtx bucket`

---

### Task 7: Prompt Language Model lebih ketat dan output dibersihkan

**Temuan (fork DravenTJU, SamhandsomeLee):** prompt yang menyuruh baris yang tidak perlu diterjemahkan disalin apa adanya, dan pembersihan code fence pembungkus pada output model.

**Desain:**
- `buildTranslatePrompt` di `src/translate/LanguageModelTranslate.ts`: tambahkan instruksi "Never merge, split, reorder or drop a line; a line that needs no translation is repeated unchanged." Instruksi jumlah baris yang ada tetap.
- Di `translateWithModel`, setelah fragmen digabung: bila input tidak mengandung "```" dan output diawali baris ```` ```<lang?> ```` serta diakhiri baris ```` ``` ````, buang kedua baris pembungkus itu. Tidak ada pembersihan lain.

**Test** (`test/non-extension/translate/languageModel.test.ts`): prompt memuat kalimat baru; output terbungkus fence dibersihkan; input yang memang berisi fence tidak diubah.

**Commit:** `fix: tighten the language model prompt and strip wrapping code fences`

---

### Task 8: Opsi menyembunyikan toolbar hover

**Temuan (fork j4rviscmd #5):** setting untuk menyembunyikan baris header hover (judul "Comment Translate", tombol replace/combine/add-selection/change-source, link sumber). Terjemahan tetap tampil.

**Desain:** setting `commentTranslate.hover.showToolbar` (boolean, default `true`, deskripsi lewat `package.nls.json`). Di master kita `createHoverMarkdownString` ada di `src/languageFeature/hoverUtil.ts` dan dipakai `src/languageFeature/hover.ts` serta `src/languageFeature/concise.ts` (`hoverMessage: [header, md]`). Implementasi ulang: saat setting `false`, kedua pemanggil tidak menyertakan header. Patch fork tidak di-apply langsung.

**Test:** unit test untuk logika pemilihan konten hover bila bisa dipisahkan menjadi fungsi murni kecil; kalau tidak, jelaskan verifikasinya di laporan.

**Commit:** `feat: add commentTranslate.hover.showToolbar to hide the hover toolbar`

---

### Task 9: Terjemahkan hanya komentar Mandarin/CJK di file aktif

**Temuan (fork paulengineer):** command menerjemahkan dan mengganti komentar berbahasa CJK saja. Versi folder di fork dilewati (destruktif massal, tanpa batas, tanpa penanganan encoding). Di fork ada juga perbaikan dispose dekorasi loading.

**Desain:**
- Command `commentTranslate.translateAllCJKComment` (judul NLS "Translate All CJK Comments in File") di submenu editor Comment Translate dan command palette, memakai jalur `translateAllForType('comment')` di `src/command/file.ts` dengan filter blok: hanya blok yang teksnya mengandung karakter CJK `[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]`.
- Perbaikan dispose (bug kosmetik terkonfirmasi): `src/command/file.ts` sekitar :101-113 dan `src/command/replaceSelections.ts` sekitar :243-249 memakai `setTimeout(dispose, …)` yang tidak terkait selesainya edit, dan `editor.edit` tidak di-await. Ganti dengan `await editor.edit(...)` lalu `dispose()` di `finally`.
- Tidak ada fitur folder/explorer.

**Test:** fungsi filter CJK murni diekspor dan dites (Mandarin, Jepang, Korea → true; Inggris, Indonesia, identifier → false). Jalur edit diverifikasi lewat tsc dan review.

**Commit:** `feat: translate only CJK comments in the current file`

---

### Task 10: VSIX dan pemasangan

Setelah semua task dan review akhir: `npx --yes @vscode/vsce@3 package --out "$TEMP/comment-translate-fork.vsix"` (prepublish menjalankan jest + webpack), pastikan isi VSIX bebas file internal, lalu pasang ke profil Zephyr dengan `code --profile "Embedded Systems-Zephyr" --install-extension <vsix> --force` dan verifikasi bundle.
