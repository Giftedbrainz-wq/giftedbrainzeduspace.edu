import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('current CBT and topic routes remain available', () => {
  assert.ok(read('node-functions/lib/api-core.js').includes('/api/cbt-tests'), '/api/cbt-tests');
  assert.ok(read('node-functions/lib/api-core.js').includes('/api/admin/topics'), '/api/admin/topics');
  assert.ok(read('node-functions/lib/api-core.js').includes('/api/battle/create'), '/api/battle/create');
});

test('student progress API uses authenticated per-student topic completion and returns percentages', () => {
  const api = read('node-functions/lib/api-core.js');
  assert.match(api, /m === "GET" && p === "\/api\/progress"/);
  assert.match(api, /m === "POST" && p === "\/api\/progress"/);
  assert.match(api, /auth\(request, "student"\)/);
  assert.match(api, /completedIds\.has\(String\(t\.id\)\)/);
  assert.match(api, /Math\.round\(completed \/ total \* 100\)/);
  assert.match(api, /topicProgress,/);
  assert.match(api, /completedTopics:\s*d\.progress\.filter/);
});

test('student UI exposes progress and current CBT search', () => {
  assert.ok(read('public/progress.html').includes('/api/progress'), '/api/progress');
  assert.ok(read('public/cbt.html').includes('id="testSearch"'), 'id="testSearch"');
  assert.ok(read('public/gb-ui.js').includes('/progress.html'), '/progress.html');
});

test('admin retains topic tools and CBT editing with access rules', () => {
  assert.ok(read('public/admin.html').includes('id="v-topics"'), 'id="v-topics"');
  assert.ok(read('public/admin.html').includes('id="v-cbt"'), 'id="v-cbt"');
  assert.ok(read('public/admin.html').includes('id="cbtAccessLevel"'), 'id="cbtAccessLevel"');
});

test('homepage and PWA remain functional', () => {
  assert.ok(read('public/index.html').includes('<html'), '<html');
  assert.ok(read('public/sw.js').includes('/progress.html'), '/progress.html');
  assert.ok(read('public/sw.js').includes('12.21.0'), '12.21.0');
});

test('learning materials use larger responsive image previews and a full-screen document reader', () => {
  const html = read('public/materials.html');
  assert.match(html, /material-detail-box/);
  assert.match(html, /max-height:min\(66vh,720px\)/);
  assert.match(html, /Tap or click image to zoom in/);
  assert.match(html, /id="documentViewer"/);
  assert.match(html, /id="documentViewerClose"/);
  assert.match(html, /data-view-document/);
  assert.match(html, /max-width:700px/);
  assert.match(html, /max-height:100dvh/);
});

test('authenticated preview fetches use bearer headers, warn on large files, and still cap memory use on low-end phones', () => {
  const api = read('public/api.js');
  assert.match(api, /Authorization: `Bearer \${token\(\)}`/);
  assert.match(api, /maxBytes/);
  assert.match(api, /too large to preview here/);
  assert.doesNotMatch(api, /larger than the \${limitMb} MB preview limit/);
  const html = read('public/materials.html');
  // A single tap on "Open material" opens the document straight away now —
  // it no longer requires an empty written note first.
  assert.match(html, /const onlyDoc=attachments\.length===1&&\["pdf","text"\]\.includes\(GBUI\.kindOf\(attachments\[0\]\)\);/);
  // Files under INLINE_PREVIEW_LIMIT open with no prompt; above that the
  // student gets a "Preview anyway" confirmation instead of being told only
  // to download it; HARD_PREVIEW_LIMIT remains the absolute ceiling passed
  // to the authenticated fetch so a very large file cannot exhaust memory on
  // an older phone even if the student taps through the warning.
  assert.match(html, /HARD_PREVIEW_LIMIT=50\*1024\*1024/);
  assert.match(html, /Preview anyway/);
  assert.match(html, /maxBytes:HARD_PREVIEW_LIMIT/);
  assert.match(api, /Your session could not be verified while opening this file/);
});

test('PDFs render with PDF.js instead of relying on the phone\'s own iframe PDF handling', () => {
  const html = read('public/materials.html');
  // Mobile browsers (iOS Safari especially) often refuse to render a blob:
  // PDF inline in an iframe and fall back to their own "tap to open" file
  // card instead of showing the document. Rendering pages onto <canvas>
  // with PDF.js avoids depending on the phone's own PDF handling at all; the
  // iframe remains only as a fallback for non-PDF files and for the rare
  // case PDF.js itself cannot parse a given file.
  // PDF.js is fetched on demand from a list of CDNs, trying each in turn,
  // instead of one hardcoded <script> tag — on a flaky connection a single
  // unreachable CDN used to mean silently falling back to the blurry/broken
  // native iframe handling for every student on that network.
  assert.match(html, /pdfjs-dist@3\.11\.174\/build/);
  assert.match(html, /cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/3\.11\.174/);
  assert.match(html, /unpkg\.com\/pdfjs-dist@3\.11\.174\/build/);
  assert.match(html, /async function ensurePdfJs/);
  assert.match(html, /async function renderPdfPages/);
  assert.match(html, /pdfjsLib\.GlobalWorkerOptions\.workerSrc=pdfjsBase/);
  assert.match(html, /id="documentViewerPdf"/);
  assert.match(html, /page\.render\(\{canvasContext:canvas\.getContext\("2d",\{alpha:false\}\),viewport,transform:/);
  // A canvas sized to CSS pixels alone renders blurry on a phone screen,
  // which packs several real pixels into each CSS pixel — and blurrier
  // still once zoomed in, since there's no extra detail to zoom into. The
  // canvas's pixel buffer is rendered at a multiple of devicePixelRatio
  // (with headroom for zooming) and then displayed back down at the CSS
  // size for it to look sharp.
  assert.match(html, /Math\.min\(window\.devicePixelRatio\|\|1,2\)/);
  assert.match(html, /page\.getViewport\(\{scale:cssScale\}\)/);
  assert.match(html, /await renderPage\(0\)/);
  assert.match(html, /IntersectionObserver/);
});

test('topic and learning material admin routes still exist', () => {
  assert.ok(read('node-functions/lib/api-core.js').includes('/api/admin/topics'), '/api/admin/topics');
  assert.ok(read('public/admin.html').includes('id="v-topics"'), 'id="v-topics"');
  assert.ok(read('public/admin.html').includes('id="v-materials"'), 'id="v-materials"');
});

test('the offline banner no longer covers the mobile menu button on any shared-shell page', () => {
  const css = read('public/styles.css');
  // .menu-toggle is fixed at the very top-left of the screen; the
  // #networkBanner is a separate full-width element stacked above almost
  // everything else, so without this rule it sat directly on top of the
  // only way to open navigation on a phone whenever a student was offline.
  assert.match(css, /body:has\(#networkBanner\.show\) \.menu-toggle\{top:54px\}/);
});

test('Question Bank mobile layout: tabs scroll instead of wrapping, rows and bulk/extract bars stack for a phone', () => {
  const admin = read('public/admin.html');
  assert.match(admin, /#v-bank #qbTabs\{flex-wrap:nowrap;overflow-x:auto/);
  assert.match(admin, /#v-bank \.qb-row\.qb-pickable \.qb-side\{grid-column:1\/-1/);
  assert.match(admin, /#v-bank \.qb-bulk-bar\{flex-direction:column/);
  assert.match(admin, /#v-bank \.qb-extract-save\{flex-direction:column/);
});

test('current admin sections and actions are reachable', () => {
  assert.ok(read('public/admin.html').includes('id="v-cbt"'), 'id="v-cbt"');
  assert.ok(read('public/admin.html').includes('id="v-students"'), 'id="v-students"');
  assert.ok(read('public/admin.html').includes('id="v-battle"') && read('public/admin.html').includes('data-src="/battle-admin.html?embedded=1"'), 'Battle Arena is embedded in the shared admin sidebar');
});

test('current CBT UI exposes test search and server access gate', () => {
  assert.ok(read('public/cbt.html').includes('id="testSearch"'), 'id="testSearch"');
  assert.ok(read('node-functions/lib/api-core.js').includes('matchesSpace(t,space)'), 'CBT API must select resources by server-enforced space');
});

test('current material editor retains attachment management', () => {
  assert.ok(read('public/admin.html').includes('id="v-materials"'), 'id="v-materials"');
  assert.ok(read('public/materials.html').includes('id="documentViewer"'), 'id="documentViewer"');
});

test('current CBT test listing preserves restricted metadata with a server-side lock', () => {
  assert.ok(read('node-functions/lib/api-core.js').includes('/api/cbt-tests'), '/api/cbt-tests');
  assert.ok(read('node-functions/lib/api-core.js').includes('matchesSpace(t,space)'), 'CBT API must select resources by server-enforced space');
  assert.ok(read('public/cbt.html').includes('id="testSearch"'), 'id="testSearch"');
});

test('visual polish includes panning zoomed images, blue-to-gold progress, and the login-success loader', () => {
  const material = read('public/materials.html');
  const styles = read('public/styles.css');
  const app = read('public/app.js');
  assert.match(material, /overflow:auto;display:block;padding:12px;touch-action:pan-x pan-y/);
  assert.match(material, /pointermove/);
  assert.match(material, /Tap or double-tap the image to zoom in and out/);
  assert.match(styles, /--gb-progress-blue:#1763c6/);
  assert.match(styles, /--gb-progress-gold:#f5b301/);
  assert.match(app, /Loading your EduSpace/);
  assert.match(app, /gb-page-loader/);
});

test('question extraction improves passage grouping, diagram association, and math normalization', () => {
  const api = read('node-functions/lib/api-core.js');
  const math = read('node-functions/lib/math-extraction.js');
  assert.match(api, /isEnglishComprehensionCue/);
  assert.match(api, /reservedAssetMarkers/);
  const pdfImages = read('node-functions/lib/pdf-image-extraction.js');
  assert.match(pdfImages, /pdfFlateImageToPng/);
  assert.match(pdfImages, /decodePdfAscii85/);
  assert.match(api, /importedType = group\?\.kind === \"cloze\"/);
  assert.match(api, /looseAssetIndex/);
  assert.match(api, /MAX_OPTIONS = 8/);
  assert.match(math, /ommlToLatex/);
  assert.match(math, /mathmlToLatex/);
  assert.match(math, /wrapBareLatexMath/);
});

test('document importer and material editor remain in application', () => {
  assert.ok(read('public/admin.html').includes('id="v-materials"'), 'id="v-materials"');
  assert.ok(read('node-functions/lib/api-core.js').includes('/api/admin/notes'), '/api/admin/notes');
});

test('front-end HTML inline scripts remain syntactically valid and use app-owned dialogs', () => {
  const publicDir = path.join(root, 'public');
  let blockCount = 0;
  const nativeDialogCall = /(?<![\w$.])(?:window\s*\.\s*)?(?:alert|confirm|prompt)\s*\(/;
  for (const file of fs.readdirSync(publicDir).filter(name => /\.(?:html|js)$/.test(name))) {
    const source = fs.readFileSync(path.join(publicDir, file), 'utf8');
    assert.doesNotMatch(source, nativeDialogCall, `${file} should not call browser-native dialogs`);
    if (!file.endsWith('.html')) continue;
    const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scripts.exec(source))) {
      if (/\bsrc\s*=/.test(match[1]) || !match[2].trim()) continue;
      assert.doesNotThrow(() => new Function(match[2]), `${file} inline script #${blockCount + 1}`);
      blockCount++;
    }
  }
  assert.ok(blockCount >= 10, `Expected inline scripts to be checked, got ${blockCount}`);
});

test('login loader is shown only after successful login and uses a logo spinner', () => {
  const app = read('public/app.js');
  const auth = read('public/auth-forms.js');
  const loader = app.slice(app.indexOf('/* Branded login-success loader.'), app.length);
  assert.match(loader, /path!=="\/login\.html" && path!=="\/admin\.html" && path!=="\/register\.html"\)return/);
  assert.match(loader, /Preparing your EduSpace/);
  assert.match(loader, /gb-loader-ring/);
  assert.match(loader, /gb-loader-mark/);
  assert.match(loader, /minMs=350/);
  assert.doesNotMatch(loader, /document\.addEventListener\("click"/);
  assert.match(auth, /const loginLoaderStarted = window\.GBLoginLoader\?\.show\?\.\(\)/);
  assert.match(auth, /hold\?\.\(loginLoaderStarted, 350\)/);
  assert.match(app, /versionNumber\(d\.version\)<versionNumber\(BASE_VERSION\)/);
});

test('current CBT editor and access settings exist', () => {
  assert.ok(read('public/admin.html').includes('id="v-cbt"'), 'id="v-cbt"');
  assert.ok(read('public/admin.html').includes('id="cbtAccessLevel"'), 'id="cbtAccessLevel"');
});

test('feedback and new Battle Arena moderation remain separate', () => {
  assert.ok(read('public/admin.html').includes('id="v-feedback"'));
  assert.ok(read('public/admin.html').includes('id="v-battle"') && read('public/battle-admin.html').includes('embedded-battle-admin'));
  assert.ok(read('node-functions/lib/api-core.js').includes('/api/admin/battle/rooms'));
  assert.ok(read('public/battle-admin.html').includes('id="matchesList"'));
});

test('PDF image extraction associates image markers and crops large white borders from embedded diagrams', () => {
  const api = read('node-functions/lib/api-core.js');
  assert.match(api, /let imageRefs = markerMatches\.length \? markerMatches : groupMarkers/);
  assert.match(api, /q\.images=images;q\.image=images\[0\]/);
  assert.match(api, /diagnostics\.imagesAttached \+= imageRefs\.length/);
  const pdfImages = read('node-functions/lib/pdf-image-extraction.js');
  assert.match(pdfImages, /const threshold = 246/);
  assert.match(pdfImages, /const outWidth = crop\.right - crop\.left \+ 1/);
});



test('Battle Arena upload and extraction use existing document parser with manual review', () => {
  const api=read('node-functions/lib/api-core.js');
  assert.match(api, /extractDocumentParts\(await readStoredFile\(key\)/);
  assert.match(api, /parseExtractedQuestions\(parts\.text/);
  assert.match(api, /d\.battleQuestions\.push\(\.\.\.out\)/);
  assert.ok(read('public/battle-admin.html').includes('id="extractReview"'));
  assert.ok(read('public/battle-admin.html').includes('id="importReviewed"'));
  assert.match(read('public/battle-admin.js'), /GB\.upload\(file/);
});
