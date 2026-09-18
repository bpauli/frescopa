import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BREAKPOINTS, frameWidth, hasGeneratedPage, pageStatusLabel, pageTitle, contentUrl,
  pageChanges, embedUrl,
} from './page-preview-logic.js';

test('frameWidth resizes the frame per breakpoint', () => {
  assert.equal(frameWidth('desktop'), '100%');
  assert.equal(frameWidth('mobile'), '390px');
});

test('frameWidth falls back to the desktop view for an unknown breakpoint', () => {
  assert.equal(frameWidth('watch'), '100%');
  assert.equal(frameWidth(''), '100%');
  assert.equal(frameWidth(undefined), '100%');
});

test('BREAKPOINTS offers Desktop and Mobile, desktop first', () => {
  assert.deepEqual(BREAKPOINTS.map((b) => b.id), ['desktop', 'mobile']);
  assert.deepEqual(BREAKPOINTS.map((b) => b.label), ['Desktop', 'Mobile']);
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
