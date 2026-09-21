import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BREAKPOINTS, previewFrame, PREVIEW_MAX_HEIGHT, hasGeneratedPage, pageStatusLabel,
  pageTitle, contentUrl, pageChanges, embedUrl, refreshStamp,
} from './page-preview-logic.js';

test('previewFrame renders the desktop viewport scaled down to fit the panel', () => {
  const box = previewFrame(640, 'desktop');
  assert.equal(box.width, 1280);
  assert.equal(box.height, 800);
  assert.equal(box.scale, 0.5);
  assert.equal(box.boxWidth, 640);
  assert.equal(box.boxHeight, 400);
});

test('previewFrame never scales a preview up and keeps it inside the panel', () => {
  ['desktop', 'mobile'].forEach((id) => {
    const box = previewFrame(4000, id);
    assert.ok(box.scale <= 1, `${id} scale ${box.scale}`);
    assert.ok(box.boxHeight <= PREVIEW_MAX_HEIGHT, `${id} height ${box.boxHeight}`);
  });
});

test('previewFrame renders mobile at the device viewport, scaled the same way', () => {
  const box = previewFrame(640, 'mobile');
  assert.equal(box.width, 390);
  assert.equal(box.height, 844);
  assert.ok(box.boxWidth < 390);
  assert.equal(box.boxHeight, PREVIEW_MAX_HEIGHT);
});

test('previewFrame falls back to a fitting desktop view without a usable width', () => {
  [0, -10, undefined, 'wide'].forEach((width) => {
    const box = previewFrame(width, 'desktop');
    assert.equal(box.width, 1280);
    assert.ok(box.scale > 0 && box.scale <= 1);
    assert.ok(box.boxHeight <= PREVIEW_MAX_HEIGHT);
  });
});

test('previewFrame falls back to the desktop breakpoint for an unknown id', () => {
  assert.deepEqual(previewFrame(640, 'watch'), previewFrame(640, 'desktop'));
});

test('BREAKPOINTS offers Desktop and Mobile as real viewports, desktop first', () => {
  assert.deepEqual(BREAKPOINTS.map((b) => b.id), ['desktop', 'mobile']);
  assert.deepEqual(BREAKPOINTS.map((b) => b.label), ['Desktop', 'Mobile']);
  assert.ok(BREAKPOINTS.every((b) => b.width > 0 && b.height > 0));
});

test('hasGeneratedPage is the preview URL, not the status', () => {
  assert.equal(hasGeneratedPage({ previewUrl: 'https://x.aem.page/a' }), true);
  assert.equal(hasGeneratedPage({ previewUrl: '  ' }), false);
  assert.equal(hasGeneratedPage({ status: 'Generated' }), false);
  assert.equal(hasGeneratedPage(null), false);
});

test('pageStatusLabel says Draft for a generated page', () => {
  assert.equal(pageStatusLabel({ previewUrl: 'https://x.aem.page/a', status: 'Generated' }), 'Draft');
  assert.equal(pageStatusLabel({ previewUrl: 'https://x.aem.page/a', status: '' }), 'Draft');
  assert.equal(pageStatusLabel({ previewUrl: 'https://x.aem.page/a', status: 'Failed' }), 'Failed');
  assert.equal(pageStatusLabel(null), 'Not generated');
});

test('pageTitle prefers the brief title', () => {
  assert.equal(pageTitle({ path: '/drafts/x' }, { title: '  Espresso at home ' }), 'Espresso at home');
});

test('pageTitle falls back to the page path, then to a neutral label', () => {
  assert.equal(pageTitle({ path: '/drafts/my-new-page' }, null), 'My new page');
  assert.equal(pageTitle({ path: '/' }, { title: '' }), 'Generated page');
  assert.equal(pageTitle(null, null), 'Generated page');
});

test('contentUrl is the preview URL with the .md extension', () => {
  assert.equal(
    contentUrl('https://main--frescopa--bpauli.aem.page/drafts/x'),
    'https://main--frescopa--bpauli.aem.page/drafts/x.md',
  );
  assert.equal(
    contentUrl('https://main--frescopa--bpauli.aem.page/drafts/x/?a=1#b'),
    'https://main--frescopa--bpauli.aem.page/drafts/x.md',
  );
  assert.equal(contentUrl('https://x.aem.page/a.html'), 'https://x.aem.page/a.md');
  assert.equal(contentUrl('https://x.aem.page/a.md'), 'https://x.aem.page/a.md');
});

test('contentUrl is empty when there is no preview URL', () => {
  assert.equal(contentUrl(''), '');
  assert.equal(contentUrl(null), '');
  assert.equal(contentUrl(42), '');
});

test('pageChanges keeps the record fields and drops the soft error', () => {
  const result = {
    path: '/drafts/x',
    previewUrl: 'https://x.aem.page/drafts/x',
    editUrl: 'https://da.live/edit#/o/s/drafts/x',
    generatedAt: '2026-01-01T00:00:00.000Z',
    status: 'Generated',
    error: 'Page saved, but the preview failed: 404 Not Found',
  };
  assert.deepEqual(pageChanges(result), {
    path: '/drafts/x',
    previewUrl: 'https://x.aem.page/drafts/x',
    editUrl: 'https://da.live/edit#/o/s/drafts/x',
    generatedAt: '2026-01-01T00:00:00.000Z',
    status: 'Generated',
  });
});

test('pageChanges normalises a missing result to empty strings', () => {
  assert.deepEqual(pageChanges(null), {
    path: '', previewUrl: '', editUrl: '', generatedAt: '', status: '',
  });
});

test('embedUrl embeds the page\'s own preview render', () => {
  assert.equal(
    embedUrl('https://main--frescopa--bpauli.aem.page/drafts/x'),
    'https://main--frescopa--bpauli.aem.page/drafts/x',
  );
});

test('embedUrl stamps the generation time so a regenerated page reloads', () => {
  const first = embedUrl('https://x.aem.page/drafts/a', '2026-01-01T00:00:00.000Z');
  const second = embedUrl('https://x.aem.page/drafts/a', '2026-01-02T00:00:00.000Z');
  assert.match(first, /^https:\/\/x\.aem\.page\/drafts\/a\?cw-generated=/);
  assert.notEqual(first, second);
});

test('embedUrl drops the fragment and keeps the page query', () => {
  assert.equal(embedUrl('https://x.aem.page/drafts/a?q=1#top'), 'https://x.aem.page/drafts/a?q=1');
});

test('embedUrl is empty when there is nothing embeddable', () => {
  assert.equal(embedUrl(''), '');
  assert.equal(embedUrl(null), '');
  assert.equal(embedUrl('/drafts/a'), '');
  assert.equal(embedUrl('javascript:alert(1)'), ''); // eslint-disable-line no-script-url
  assert.equal(embedUrl(42), '');
});

test('refreshStamp is the bare generation time before any refresh', () => {
  const base = '2026-01-01T00:00:00.000Z';
  assert.equal(refreshStamp(base, 0), base);
  assert.equal(refreshStamp(base), base);
  assert.equal(refreshStamp(base, -2), base);
  assert.equal(refreshStamp(base, 'later'), base);
  assert.equal(refreshStamp('', 0), '');
});

test('refreshStamp changes deterministically with every refresh tick', () => {
  const base = '2026-01-01T00:00:00.000Z';
  const first = refreshStamp(base, 1);
  const second = refreshStamp(base, 2);
  assert.notEqual(first, base);
  assert.notEqual(first, second);
  assert.equal(refreshStamp(base, 1), first);
});

test('refreshStamp still stamps a page that has no generation time', () => {
  assert.equal(refreshStamp('', 1), refreshStamp(null, 1));
  assert.notEqual(refreshStamp('', 1), '');
});

test('embedUrl reloads the frame for a refreshed stamp', () => {
  const page = 'https://x.aem.page/drafts/a';
  const before = embedUrl(page, refreshStamp('2026-01-01T00:00:00.000Z', 0));
  const after = embedUrl(page, refreshStamp('2026-01-01T00:00:00.000Z', 1));
  assert.notEqual(before, after);
  assert.match(before, /^https:\/\/x\.aem\.page\/drafts\/a\?cw-generated=/);
  assert.match(after, /^https:\/\/x\.aem\.page\/drafts\/a\?cw-generated=/);
});
