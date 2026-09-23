import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LOCALIZE_TIMEOUT_MS,
  CHROME_LOCALE_ROOTS,
  CHROME_DOCS,
  resolveLocale,
  buildLocaleRow,
  buildLocalizePrompt,
  extractDoc,
  countBlocks,
  extractSrcs,
  verifyTranslation,
} from './localization.js';

// A miniature of a real Stage 4/5 doc: the DA page envelope, two sections, and
// a Stage 5 asset URL carrying the `#width=&height=` fragment.
const SOURCE = '<body><header></header><main>'
  + '<div><h1>Fresh coffee, every morning</h1>'
  + '<p><img src="https://content.da.live/bpauli/frescopa/projects/x/slot-0.jpg#width=2688&amp;height=1512" alt="A barista pouring a latte"></p>'
  + '<p>Roasted in small batches.</p></div>'
  + '<div><h2>Our machines</h2><ul><li>Freshly ground</li></ul></div>'
  + '</main><footer></footer></body>';

// The same doc as AO returns it: text nodes and `alt` in French, every tag,
// class and URL byte-identical.
const TRANSLATED = SOURCE
  .replace('Fresh coffee, every morning', 'Du café frais, tous les matins')
  .replace('A barista pouring a latte', 'Un barista versant un latte')
  .replace('Roasted in small batches.', 'Torréfié en petits lots.')
  .replace('Our machines', 'Nos machines')
  .replace('Freshly ground', 'Fraîchement moulu');

// --- resolveLocale ---

test('resolveLocale answers the catalog entry for a code', () => {
  assert.deepEqual(resolveLocale('fr-FR'), { code: 'fr-FR', label: 'French (France)', prefix: '/fr' });
  assert.deepEqual(resolveLocale({ code: 'ja-jp' }), { code: 'ja-JP', label: 'Japanese (Japan)', prefix: '/jp' });
});

test('resolveLocale keeps the fields of a locale the catalog does not carry', () => {
  assert.deepEqual(resolveLocale({ code: 'el-GR', label: 'Greek (Greece)', prefix: '/gr' }), {
    code: 'el-GR', label: 'Greek (Greece)', prefix: '/gr',
  });
  assert.deepEqual(resolveLocale('el-GR'), { code: 'el-GR', label: 'el-GR', prefix: '' });
});

test('resolveLocale answers null without a code', () => {
  assert.equal(resolveLocale(''), null);
  assert.equal(resolveLocale(null), null);
  assert.equal(resolveLocale({ label: 'French (France)' }), null);
});

// --- buildLocaleRow ---

test('buildLocaleRow fills the locales sheet row', () => {
  const row = buildLocaleRow(resolveLocale('fr-FR'), {
    status: 'Generated',
    path: '/fr/drafts/x',
    previewUrl: 'https://main--frescopa--bpauli.aem.page/fr/drafts/x',
    editUrl: 'https://da.live/edit#/bpauli/frescopa/fr/drafts/x',
    generatedAt: '2026-09-23T09:00:00.000Z',
    error: null,
  });
  assert.deepEqual(row, {
    code: 'fr-FR',
    label: 'French (France)',
    prefix: '/fr',
    isDefault: false,
    status: 'Generated',
    path: '/fr/drafts/x',
    previewUrl: 'https://main--frescopa--bpauli.aem.page/fr/drafts/x',
    editUrl: 'https://da.live/edit#/bpauli/frescopa/fr/drafts/x',
    generatedAt: '2026-09-23T09:00:00.000Z',
    error: null,
  });
});

test('buildLocaleRow marks the default locale and defaults to a failed row', () => {
  const row = buildLocaleRow(resolveLocale('en-US'));
  assert.equal(row.isDefault, true);
  assert.equal(row.prefix, '');
  assert.equal(row.status, 'Failed');
  assert.equal(row.error, null);
  assert.match(row.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('buildLocaleRow survives a missing locale', () => {
  const row = buildLocaleRow(null, { error: 'Pick a locale first.' });
  assert.equal(row.code, '');
  assert.equal(row.isDefault, false);
  assert.equal(row.error, 'Pick a locale first.');
});

// --- buildLocalizePrompt ---

test('buildLocalizePrompt names the target language and carries the doc verbatim', () => {
  const prompt = buildLocalizePrompt(SOURCE, resolveLocale('fr-FR'));
  assert.match(prompt, /from English to French \(France\) \(fr-FR\)/);
  assert.ok(prompt.endsWith(SOURCE), 'the document is the last thing in the prompt');
});

test('buildLocalizePrompt states the rules the gate proved', () => {
  const prompt = buildLocalizePrompt(SOURCE, resolveLocale('ja-JP'));
  // Text and alt only, nothing else.
  assert.match(prompt, /Translate ONLY human-readable text nodes and the value of `alt`/);
  // The fragment that carries width/height onto the rendered <img> (#60).
  assert.match(prompt, /#width=\.\.\.&height=\.\.\.` fragment on every image URL must survive/);
  // No fence, no prose - the reply is posted to DA as-is.
  assert.match(prompt, /no markdown code fence/);
  // Block names and metadata keys are structure, not copy.
  assert.match(prompt, /block names \(the first row of a block table\)/);
});

test('the AO turn is pinned well past the 60 s default', () => {
  assert.equal(LOCALIZE_TIMEOUT_MS, 300000);
});

// --- extractDoc ---

test('extractDoc keeps a bare body envelope exactly as AO returned it', () => {
  assert.equal(extractDoc(TRANSLATED), TRANSLATED);
  assert.equal(extractDoc(`\n${TRANSLATED}\n`), TRANSLATED);
});

test('extractDoc unwraps a code fence and drops prose around the doc', () => {
  assert.equal(extractDoc(`Here you go:\n\n${TRANSLATED}`), TRANSLATED);
  assert.equal(extractDoc('```html\n<body><main><div><p>Bonjour</p></div></main></body>\n```'), '<body><main><div><p>Bonjour</p></div></main></body>');
});

test('extractDoc answers empty when there is no document', () => {
  assert.equal(extractDoc('I cannot translate that.'), '');
  assert.equal(extractDoc('<body><main>unclosed'), '');
  assert.equal(extractDoc(''), '');
  assert.equal(extractDoc(null), '');
});

// --- countBlocks / extractSrcs ---

test('countBlocks counts every div in the doc', () => {
  assert.equal(countBlocks(SOURCE), 2);
  assert.equal(countBlocks('<div class="teaser dark right"><div><div>a</div></div></div>'), 3);
  assert.equal(countBlocks(''), 0);
  assert.equal(countBlocks(null), 0);
});

test('extractSrcs reads every src and srcset in document order', () => {
  assert.deepEqual(extractSrcs(SOURCE), [
    'https://content.da.live/bpauli/frescopa/projects/x/slot-0.jpg#width=2688&amp;height=1512',
  ]);
  const picture = '<picture><source srcset="/media_a.png?w=750" media="(min-width: 600px)">'
    + "<img src='/media_a.png#width=2688&height=1512'></picture>";
  assert.deepEqual(extractSrcs(picture), ['/media_a.png?w=750', '/media_a.png#width=2688&height=1512']);
  assert.deepEqual(extractSrcs(''), []);
});

// --- verifyTranslation: the check that stands before the write ---

test('verifyTranslation passes a doc whose text and alt changed and nothing else', () => {
  assert.deepEqual(verifyTranslation(SOURCE, TRANSLATED), { ok: true, error: null });
});

test('verifyTranslation catches a doc that lost content', () => {
  // The gate's 54 KB case: a well-formed reply, a quarter of the doc gone.
  const dropped = TRANSLATED.replace('<div><h2>Nos machines</h2><ul><li>Fraîchement moulu</li></ul></div>', '');
  const { ok, error } = verifyTranslation(SOURCE, dropped);
  assert.equal(ok, false);
  assert.match(error, /1 blocks instead of 2/);
});

test('verifyTranslation catches one slipped character in a media hash', () => {
  // The gate's 27 KB case: one bad URL out of 130, written with 201/200 and no
  // warning anywhere, rendering as about:error.
  const corrupt = TRANSLATED.replace('slot-0.jpg', 'slot-0 .jpg');
  const { ok, error } = verifyTranslation(SOURCE, corrupt);
  assert.equal(ok, false);
  assert.match(error, /altered an image URL/);
  assert.match(error, /slot-0 \.jpg/);
});

test('verifyTranslation catches a dropped image and a dropped fragment', () => {
  const noImage = TRANSLATED.replace(/<img[^>]*>/, '');
  assert.equal(verifyTranslation(SOURCE, noImage).ok, false);
  assert.match(verifyTranslation(SOURCE, noImage).error, /changed the images: 0 instead of 1/);

  // Losing `#width=&height=` is the CLS regression #60 fixed.
  const noFragment = TRANSLATED.replace('#width=2688&amp;height=1512', '');
  assert.equal(verifyTranslation(SOURCE, noFragment).ok, false);
});

test('verifyTranslation refuses an empty translation', () => {
  assert.deepEqual(verifyTranslation(SOURCE, ''), { ok: false, error: 'The translation came back empty.' });
  assert.equal(verifyTranslation(SOURCE, null).ok, false);
});

// --- site chrome ---

test('the chrome locale roots mirror the header and footer blocks', () => {
  // blocks/header/header.js and blocks/footer/footer.js prefix the fragment
  // path for exactly these roots; a page under any other prefix is served the
  // site's root chrome, so there is nothing to create for it.
  assert.deepEqual(CHROME_LOCALE_ROOTS, ['es', 'fr', 'jp', 'de']);
  assert.deepEqual(CHROME_DOCS, ['/nav', '/footer']);
});
