import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LOCALE_CODE, LOCALES, defaultLocale, findLocale, isDefaultLocale,
  localePath, searchLocales,
} from './locales.js';

test('the catalog leads with the locales this site actually serves', () => {
  assert.deepEqual(
    LOCALES.slice(0, 4).map((l) => l.code),
    ['en-US', 'fr-FR', 'es-MX', 'ja-JP'],
  );
  // The prefixes are the site's own folders from paths.json - and ja-JP -> /jp
  // is why a prefix can never be derived from the code.
  assert.equal(findLocale('fr-FR').prefix, '/fr');
  assert.equal(findLocale('es-MX').prefix, '/es');
  assert.equal(findLocale('ja-JP').prefix, '/jp');
});

test('every catalog entry is well formed and unique', () => {
  const codes = new Set();
  const prefixes = new Set();
  LOCALES.forEach((l) => {
    assert.match(l.code, /^[a-z]{2}-[A-Z]{2}$/, `${l.code} is a BCP-47 tag`);
    assert.ok(l.label.trim(), `${l.code} has a label`);
    assert.ok(!codes.has(l.code), `${l.code} appears once`);
    assert.ok(!prefixes.has(l.prefix), `${l.prefix} is served by one locale`);
    codes.add(l.code);
    prefixes.add(l.prefix);
    if (l.code === DEFAULT_LOCALE_CODE) assert.equal(l.prefix, '');
    else assert.match(l.prefix, /^\/[a-z]+$/, `${l.code} has a site prefix`);
  });
});

test('the default locale is the root-served English the Stage 4 page is written in', () => {
  assert.equal(defaultLocale().code, 'en-US');
  assert.equal(defaultLocale().prefix, '');
  assert.ok(isDefaultLocale('en-US'));
  assert.ok(isDefaultLocale({ code: 'EN-us' }));
  assert.ok(!isDefaultLocale('fr-FR'));
  assert.ok(!isDefaultLocale(null));
});

test('findLocale is case-insensitive and answers null for a stranger', () => {
  assert.equal(findLocale('ja-jp').label, 'Japanese (Japan)');
  assert.equal(findLocale('  fr-FR  ').code, 'fr-FR');
  assert.equal(findLocale('xx-XX'), null);
  assert.equal(findLocale(''), null);
  assert.equal(findLocale(undefined), null);
});

test('searchLocales matches the label or the code, case-insensitively', () => {
  assert.deepEqual(searchLocales('japan').map((l) => l.code), ['ja-JP']);
  assert.deepEqual(searchLocales('JAPANESE').map((l) => l.code), ['ja-JP']);
  // "fr" is in the label of French (France) and in the code fr-FR.
  assert.deepEqual(searchLocales('fr').map((l) => l.code), ['fr-FR']);
  assert.deepEqual(searchLocales('zh').map((l) => l.code), ['zh-CN', 'zh-TW']);
});

test('searchLocales keeps catalog order, so the site own locales lead', () => {
  const codes = searchLocales('').map((l) => l.code);
  assert.deepEqual(codes.slice(0, 4), ['en-US', 'fr-FR', 'es-MX', 'ja-JP']);
  assert.equal(codes.length, LOCALES.length);
});

test('searchLocales hides what is already selected, by code or by row', () => {
  assert.ok(!searchLocales('', ['fr-FR']).some((l) => l.code === 'fr-FR'));
  assert.ok(!searchLocales('', [{ code: 'ja-JP' }]).some((l) => l.code === 'ja-JP'));
  assert.ok(!searchLocales('french', ['FR-fr']).length);
  // Junk in the selected list never hides a real locale.
  assert.equal(searchLocales('', [null, '', {}]).length, LOCALES.length);
});

test('localePath puts the site prefix in front of the Stage 4 path', () => {
  assert.equal(localePath(findLocale('fr-FR'), '/drafts/x'), '/fr/drafts/x');
  assert.equal(localePath('/jp', '/drafts/ai-video-generator'), '/jp/drafts/ai-video-generator');
  assert.equal(localePath('es', '/a/b/c'), '/es/a/b/c');
  assert.equal(localePath('/es/', '/a'), '/es/a');
});

test('localePath leaves the default locale path alone - it IS the Stage 4 page', () => {
  assert.equal(localePath(defaultLocale(), '/drafts/x'), '/drafts/x');
  assert.equal(localePath('', '/drafts/x'), '/drafts/x');
});

test('localePath never doubles a prefix that is already there', () => {
  assert.equal(localePath('/fr', '/fr/drafts/x'), '/fr/drafts/x');
  assert.equal(localePath('/fr', '/fr'), '/fr');
  // A path that merely STARTS with the letters is still prefixed.
  assert.equal(localePath('/fr', '/french/x'), '/fr/french/x');
});

test('localePath normalizes a path with no leading slash, and refuses an empty one', () => {
  assert.equal(localePath('/fr', 'drafts/x'), '/fr/drafts/x');
  assert.equal(localePath('/fr', ''), '');
  assert.equal(localePath('/fr', null), '');
});
