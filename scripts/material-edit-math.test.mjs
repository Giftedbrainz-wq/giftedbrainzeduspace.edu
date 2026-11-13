import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { normaliseImportedMathMarkup, ommlToLatex, mathmlToLatex } from '../node-functions/lib/math-extraction.js';
import { decodePdfText } from '../node-functions/lib/pdf-text-extraction.js';
import { decodePdfAscii85, extractPdfImageAssets, pdfFlateImageToPng } from '../node-functions/lib/pdf-image-extraction.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function getBrowserMathWrapper() {
  const source = fs.readFileSync(path.join(root, 'public/gb-ui.js'), 'utf8');
  const start = source.indexOf('  function mathHtml(value) {');
  const end = source.indexOf('\n  function renderMath(root = document)', start);
  assert.ok(start >= 0 && end > start, 'browser math renderer should be present');
  const sandbox = {
    window: {},
    esc: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end) + '\nglobalThis.testWrap = mathHtml;', sandbox);
  return sandbox.testWrap;
}

test('normalises common bare LaTeX equations without separating operators', () => {
  assert.equal(normaliseImportedMathMarkup('\\frac{a}{b}=\\frac{c}{d}'), '\\(\\frac{a}{b}=\\frac{c}{d}\\)');
  assert.equal(normaliseImportedMathMarkup('\\alpha + \\beta = \\theta'), '\\(\\alpha + \\beta = \\theta\\)');
  assert.equal(normaliseImportedMathMarkup('x_i \\in A'), '\\(x_i \\in A\\)');
  assert.equal(normaliseImportedMathMarkup('x=\\frac{a}{b}'), '\\(x=\\frac{a}{b}\\)');
  assert.equal(normaliseImportedMathMarkup('\\sin x + \\cos y = 1'), '\\(\\sin x + \\cos y = 1\\)');
});

test('preserves scripts, roots, integrals, summations, arrows and multi-row environments', () => {
  assert.equal(normaliseImportedMathMarkup('\\sum_{i=1}^{n} x_i'), '\\(\\sum_{i=1}^{n} x_i\\)');
  assert.equal(normaliseImportedMathMarkup('\\int_0^1 f(x) dx'), '\\(\\int_0^1 f(x) dx\\)');
  assert.equal(normaliseImportedMathMarkup('\\sqrt[3]{x}'), '\\(\\sqrt[3]{x}\\)');
  assert.equal(normaliseImportedMathMarkup('\\xrightarrow[below]{above}'), '\\(\\xrightarrow[below]{above}\\)');
  assert.equal(normaliseImportedMathMarkup('\\operatorname*{arg max}_{x} f(x)'), '\\(\\operatorname*{arg max}_{x} f(x)\\)');
  assert.equal(normaliseImportedMathMarkup('\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}'), '\\(\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}\\)');
  assert.equal(normaliseImportedMathMarkup('\\begin{cases}x^2,&x>0\\\\0,&x\\leq0\\end{cases}'), '\\(\\begin{cases}x^2,&x>0\\\\0,&x\\leq0\\end{cases}\\)');
  assert.equal(normaliseImportedMathMarkup('\\left. x^2 \\right|_{0}^{1}'), '\\(\\left. x^2 \\right|_{0}^{1}\\)');
});

test('preserves unknown/custom macro arguments for browser rendering instead of stripping them', () => {
  assert.equal(normaliseImportedMathMarkup('\\custommacro{a+b}+c'), '\\(\\custommacro{a+b}+c\\)');
  assert.equal(normaliseImportedMathMarkup('\\custommacro*{a+b}'), '\\(\\custommacro*{a+b}\\)');
  assert.equal(normaliseImportedMathMarkup('The value is \\frac{1}{2} in simplest form.'), 'The value is \\(\\frac{1}{2}\\) in simplest form.');
  assert.equal(normaliseImportedMathMarkup('Already \\(x^2+1\\) done'), 'Already \\(x^2+1\\) done');
  assert.equal(normaliseImportedMathMarkup('x^2 + y_{n+1}'), 'x<sup>2</sup> + y<sub>n+1</sub>');
});

test('converts Office Math OMML structures into LaTeX', () => {
  const fraction = '<m:oMath xmlns:m="urn:m"><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>';
  const radical = '<m:oMath xmlns:m="urn:m"><m:rad><m:radPr/><m:deg><m:r><m:t>3</m:t></m:r></m:deg><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>';
  assert.equal(ommlToLatex(fraction), '\\frac{a}{b}');
  assert.equal(ommlToLatex(radical), '\\sqrt[3]{x}');
});

test('converts HTML MathML fractions, roots, scripts and matrices', () => {
  assert.equal(mathmlToLatex('<math><mrow><mi>x</mi><mo>=</mo><mfrac><mn>1</mn><mn>2</mn></mfrac></mrow></math>'), 'x=\\frac{1}{2}');
  assert.equal(mathmlToLatex('<math><msubsup><mi>x</mi><mn>1</mn><mn>2</mn></msubsup><mo>+</mo><msqrt><mi>y</mi></msqrt></math>'), 'x_{1}^{2}+\\sqrt{y}');
  assert.equal(mathmlToLatex('<math><mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>2</mn></mtd></mtr><mtr><mtd><mn>3</mn></mtd><mtd><mn>4</mn></mtd></mtr></mtable></math>'), '\\begin{matrix}1 & 2 \\\\ 3 & 4\\end{matrix}');
});

test('browser math renderer converts common formulas and preserves safe display markup', () => {
  const render = getBrowserMathWrapper();
  assert.match(render('\\frac{a}{b}'), /gb-frac/);
  const greek = render('\\alpha + \\beta = \\theta');
  assert.match(greek, /α/);
  assert.match(greek, /β/);
  assert.match(greek, /θ/);
  assert.match(render('x_i \\in A'), /x<sub>i<\/sub>/);
  assert.match(render('x=\\frac{a}{b}'), /x=<span class="gb-math-fallback"><span class="gb-frac">/);
  assert.match(render('\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}'), /gb-matrix/);
  assert.match(render('x^2 + y_{n+1}'), /<sup>2<\/sup>/);
  assert.match(render('<script>bad<\/script>'), /&lt;script&gt;/);
});

test('groups consecutive Unicode exponents/subscripts and recognises additional MathML operators', () => {
  assert.equal(normaliseImportedMathMarkup('10⁻³'), '10<sup>-3</sup>');
  assert.equal(normaliseImportedMathMarkup('x₁₂'), 'x<sub>12</sub>');
  assert.equal(mathmlToLatex('<math><mi>α</mi><mo>∈</mo><mi>R</mi><mo>±</mo><mn>2</mn></math>'), '\\alpha \\in R\\pm 2');
});

test('PDF text extraction preserves mathematical digits, exponents and TJ text', () => {
  const content = '<< /Length 100 >>\nstream\nBT\n/F1 12 Tf\n1 0 0 1 50 700 Tm\n(x^2 + 2) Tj\n[(A. x2) -20 (B. 3)] TJ\n0 -20 Td\n(Answer 4) Tj\nET\nendstream';
  const extracted = decodePdfText(Buffer.from(content, 'latin1'));
  assert.match(extracted, /x\^2 \+ 2/);
  assert.match(extracted, /A\. x2/);
  assert.match(extracted, /B\. 3/);
  assert.match(extracted, /Answer 4/);
});

test('PDF image extraction rebuilds Flate-compressed RGB diagram data as a real PNG', async () => {
  const zlib = await import('node:zlib');
  const pixelRow = Buffer.from([0, 255, 0, 0, 0, 255, 0]); // PNG predictor 15, then red and green RGB pixels.
  const compressed = zlib.deflateSync(pixelRow);
  const dictionary = '<< /Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Columns 2 /Colors 3 /BitsPerComponent 8 >> /Length 100 >>\nstream\n';
  const pdf = Buffer.concat([Buffer.from(dictionary, 'latin1'), compressed, Buffer.from('\nendstream', 'latin1')]);
  const assets = extractPdfImageAssets(pdf);
  assert.equal(assets.size, 1);
  const image = [...assets.values()][0];
  assert.equal(image.contentType, 'image/png');
  assert.deepEqual([...image.data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(image.data.readUInt32BE(16), 2);
  assert.equal(image.data.readUInt32BE(20), 1);
});

test('PDF ASCII85 image filter decoding recognises the zero-block shorthand', () => {
  assert.deepEqual([...decodePdfAscii85(Buffer.from('z~>', 'latin1'))], [0, 0, 0, 0]);
});

test('editing existing materials does not require title or note body', () => {
  const admin = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
  const start = admin.indexOf('function editNoteModal(n)');
  const end = admin.indexOf('\nasync function uploadAll', start);
  assert.ok(start >= 0 && end > start, 'edit material modal should exist');
  const modal = admin.slice(start, end);
  assert.doesNotMatch(modal, /Title and note content are required/);
  assert.match(modal, /if\(title\)payload\.title=title/);
  assert.match(modal, /if\(body\)payload\.body=body/);
  assert.match(modal, /leave blank to keep the existing note content/i);
  const api = fs.readFileSync(path.join(root, 'node-functions/lib/api-core.js'), 'utf8');
  assert.match(api, /if\s*\(x\.title\s*!==\s*void 0\)\s*n\.title\s*=/);
  assert.match(api, /if\s*\(x\.body\s*!==\s*void 0\)\s*\{/);
});

test('trims a conservative white margin around an embedded PDF diagram', () => {
  const width=20,height=20,colors=3;
  const pixels=Buffer.alloc(width*height*colors,255);
  for(let y=6;y<=13;y++)for(let x=7;x<=12;x++){
    const at=(y*width+x)*colors;pixels[at]=0;pixels[at+1]=0;pixels[at+2]=0;
  }
  const dict='<< /Width 20 /Height 20 /ColorSpace /DeviceRGB /BitsPerComponent 8 >>';
  const png=pdfFlateImageToPng(pixels,dict);
  assert.ok(png);
  assert.equal(png.readUInt32BE(16),12);
  assert.equal(png.readUInt32BE(20),14);
});
