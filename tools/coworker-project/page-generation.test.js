import test from 'node:test';
import assert from 'node:assert/strict';

import {
  derivePagePath, pageUrls, cleanSections, buildInnerHtml, placeholderImageHtml, placeholderLabel,
} from './page-generation.js';

test('derivePagePath slugifies segments and drops the extension', () => {
  assert.equal(derivePagePath('Drafts/My New Page.html'), '/drafts/my-new-page');
  assert.equal(derivePagePath('/products/espresso'), '/products/espresso');
  assert.equal(derivePagePath('  /Coffee Machines/  '), '/coffee-machines');
  assert.equal(derivePagePath('/notes.md'), '/notes');
});

test('derivePagePath keeps only the pathname of an absolute URL', () => {
  assert.equal(
    derivePagePath('https://main--frescopa--bpauli.aem.page/drafts/stage4?x=1'),
    '/drafts/stage4',
  );
});

test('derivePagePath returns an empty string when nothing usable is left', () => {
  assert.equal(derivePagePath(''), '');
  assert.equal(derivePagePath('///'), '');
  assert.equal(derivePagePath(null), '');
  assert.equal(derivePagePath(42), '');
});

test('pageUrls builds the aem.page preview URL and the DA edit URL', () => {
  assert.deepEqual(pageUrls('bpauli', 'frescopa', '/drafts/x'), {
    previewUrl: 'https://main--frescopa--bpauli.aem.page/drafts/x',
    editUrl: 'https://da.live/edit#/bpauli/frescopa/drafts/x',
  });
});

test('cleanSections normalises a raw AO outline', () => {
  const raw = {
    sections: [{
      heading: '  Fresh coffee, every morning  ',
      body: [' A short hero line. ', '', 'A second line.'],
      bullets: ['  Freshly ground ', ''],
      image: { alt: ' A barista pouring a latte ' },
      cta: { label: ' Shop machines ', url: 'products/machines' },
    }],
  };
  assert.deepEqual(cleanSections(raw), [{
    heading: 'Fresh coffee, every morning',
    body: ['A short hero line.', 'A second line.'],
    bullets: ['Freshly ground'],
    image: { alt: 'A barista pouring a latte' },
    cta: { label: 'Shop machines', url: '/products/machines' },
  }]);
});

test('cleanSections accepts a bare array, a string body and a string image', () => {
  const cleaned = cleanSections([{ heading: 'H', body: 'One paragraph.', image: 'A cup of coffee' }]);
  assert.deepEqual(cleaned[0].body, ['One paragraph.']);
  assert.deepEqual(cleaned[0].image, { alt: 'A cup of coffee' });
  assert.deepEqual(cleaned[0].bullets, []);
  assert.equal(cleaned[0].cta, null);
});

test('cleanSections drops an empty section, a label-less CTA and a bad CTA scheme', () => {
  const cleaned = cleanSections([
    { image: { alt: 'orphan image' } },
    { heading: 'Keep me', cta: { url: '/somewhere' } },
    { heading: 'And me', cta: { label: 'Mail us', url: 'mailto:hi@example.com' } },
  ]);
  assert.equal(cleaned.length, 2);
  assert.equal(cleaned[0].cta, null);
  assert.equal(cleaned[1].cta, null);
});

test('cleanSections caps the number of sections, paragraphs and bullets', () => {
  const many = (n, v) => Array.from({ length: n }, (_, i) => `${v} ${i}`);
  const cleaned = cleanSections(many(20, 'x').map(() => ({
    heading: 'H', body: many(10, 'p'), bullets: many(12, 'b'),
  })), 3);
  assert.equal(cleaned.length, 3);
  assert.equal(cleaned[0].body.length, 6);
  assert.equal(cleaned[0].bullets.length, 8);
});

test('cleanSections returns an empty array for junk input', () => {
  assert.deepEqual(cleanSections(null), []);
  assert.deepEqual(cleanSections({ nope: 1 }), []);
});

test('placeholderLabel keeps a short description and cuts a long one at a word boundary', () => {
  assert.equal(placeholderLabel('A cup of coffee'), 'A cup of coffee');
  assert.equal(placeholderLabel(''), 'Image placeholder');
  assert.equal(
    placeholderLabel('A sleek espresso machine on a warm-toned kitchen counter pouring a shot.'),
    'A sleek espresso machine on a warm-toned kitchen counter...',
  );
});

test('placeholderImageHtml keeps the description in alt and never invents an asset', () => {
  const html = placeholderImageHtml('A barista pouring a latte');
  assert.match(html, /^<img src="https:\/\/placehold\.co\//);
  assert.match(html, /alt="A barista pouring a latte">$/);
  assert.match(html, /text=A%20barista%20pouring%20a%20latte/);
});

test('buildInnerHtml emits one div per section, h1 first then h2', () => {
  const html = buildInnerHtml(cleanSections([
    { heading: 'Hero', body: ['Lead.'] },
    { heading: 'Second', body: ['More.'] },
  ]));
  assert.equal(
    html,
    '<div><h1>Hero</h1><p>Lead.</p></div><div><h2>Second</h2><p>More.</p></div>',
  );
});

test('buildInnerHtml orders heading, image, paragraphs, bullets and CTA', () => {
  const html = buildInnerHtml(cleanSections([{
    heading: 'Hero',
    body: ['Lead.'],
    bullets: ['One', 'Two'],
    image: { alt: 'A cup' },
    cta: { label: 'Buy', url: '/shop' },
  }]));
  assert.match(html, /^<div><h1>Hero<\/h1><p><img src="https:\/\/placehold\.co\/[^"]+" alt="A cup"><\/p>/);
  assert.match(html, /<p>Lead\.<\/p><ul><li>One<\/li><li>Two<\/li><\/ul>/);
  assert.match(html, /<p><a href="\/shop">Buy<\/a><\/p><\/div>$/);
});

test('buildInnerHtml escapes authored text', () => {
  const html = buildInnerHtml(cleanSections([{
    heading: 'Tea & <script>alert(1)</script>',
    body: ['He said "hello" & left.'],
    cta: { label: '<b>Go</b>', url: '/a"b' },
  }]));
  assert.match(html, /<h1>Tea &amp; &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/h1>/);
  assert.match(html, /<p>He said &quot;hello&quot; &amp; left\.<\/p>/);
  assert.match(html, /<a href="\/a&quot;b">&lt;b&gt;Go&lt;\/b&gt;<\/a>/);
  assert.doesNotMatch(html, /<script>/);
});

test('buildInnerHtml is empty for no sections', () => {
  assert.equal(buildInnerHtml([]), '');
  assert.equal(buildInnerHtml(null), '');
});
