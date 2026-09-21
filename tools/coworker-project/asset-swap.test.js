import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assetExtension,
  assetDaPath,
  daContentUrl,
  assetGeometry,
  mediaRef,
  swapAssetSrc,
  fetchAssetBytes,
  uploadAsset,
  storeAsset,
  storeAssets,
  writePageDoc,
  previewPage,
  swapAssetsIntoPage,
} from './asset-swap.js';

// A Stage 4 page doc, as page-generation.js writes it and DA hands it back.
const PLACEHOLDER = 'https://placehold.co/1600x900/e9e9e9/6b6b6b?text=Green%20beans';
const slotImg = (alt, src = PLACEHOLDER) => `<img src="${src}" alt="${alt}">`;
const doc = (...imgs) => `<body><header></header><main>${
  imgs.map((img, i) => `<div><h${i ? 2 : 1}>Section ${i}</h${i ? 2 : 1}><p>${img}</p></div>`).join('')
}</main><footer></footer></body>`;

const MEDIA_0 = 'https://content.da.live/bpauli/frescopa/projects/coffee/slot-0.jpg';
const MEDIA_1 = 'https://content.da.live/bpauli/frescopa/projects/coffee/slot-1.jpg';

// --- assetExtension ---

test('assetExtension maps an image content type to a file extension', () => {
  assert.equal(assetExtension('image/jpeg'), 'jpg');
  assert.equal(assetExtension('image/png'), 'png');
  assert.equal(assetExtension('image/webp'), 'webp');
  assert.equal(assetExtension('IMAGE/PNG; charset=binary'), 'png');
});

test('assetExtension falls back to jpg, which is what Firefly returns', () => {
  assert.equal(assetExtension(''), 'jpg');
  assert.equal(assetExtension(undefined), 'jpg');
  assert.equal(assetExtension('application/octet-stream'), 'jpg');
});

// --- assetDaPath ---

test('assetDaPath puts one deterministic file per slot under the project', () => {
  assert.equal(assetDaPath('coffee', 0, 'image/jpeg'), '/projects/coffee/slot-0.jpg');
  assert.equal(assetDaPath('coffee', 3, 'image/png'), '/projects/coffee/slot-3.png');
});

test('assetDaPath is stable, so a Regenerate overwrites that slot', () => {
  assert.equal(
    assetDaPath('coffee', 2, 'image/jpeg'),
    assetDaPath('coffee', 2, 'image/jpeg'),
  );
});

test('assetDaPath slugifies the project and refuses an unusable slot', () => {
  assert.equal(assetDaPath('Green Coffee!', 1), '/projects/green-coffee/slot-1.jpg');
  assert.equal(assetDaPath('', 0), '');
  assert.equal(assetDaPath('coffee', -1), '');
  assert.equal(assetDaPath('coffee', 'hero'), '');
});

// --- daContentUrl ---

test('daContentUrl builds the public DA URL for a source path', () => {
  assert.equal(
    daContentUrl('bpauli', 'frescopa', '/projects/coffee/slot-0.jpg'),
    MEDIA_0,
  );
});

// --- assetGeometry ---

test('assetGeometry prefers the generated image dimensions', () => {
  assert.deepEqual(assetGeometry({ width: 2688, height: 1512, aspect: '1:1' }), {
    width: 2688, height: 1512,
  });
});

test('assetGeometry falls back to the Firefly size the aspect resolves to', () => {
  assert.deepEqual(assetGeometry({ aspect: '16:9' }), { width: 2688, height: 1512 });
  assert.deepEqual(assetGeometry({ aspect: '1:1' }), { width: 2048, height: 2048 });
});

// --- mediaRef ---

test('mediaRef pins the width/height fragment the pipeline needs', () => {
  assert.equal(mediaRef(MEDIA_0, 2688, 1512), `${MEDIA_0}#width=2688&height=1512`);
});

test('mediaRef keeps a fragment the caller already pinned', () => {
  const ref = `${MEDIA_0}#width=100&height=50`;
  assert.equal(mediaRef(ref, 2688, 1512), ref);
});

test('mediaRef drops an unusable geometry rather than lying about it', () => {
  assert.equal(mediaRef(MEDIA_0, 0, 0), MEDIA_0);
  assert.equal(mediaRef(MEDIA_0), MEDIA_0);
});

test('mediaRef refuses anything that is not an http URL', () => {
  assert.equal(mediaRef('', 10, 10), '');
  assert.equal(mediaRef('data:image/png;base64,AAAA', 10, 10), '');
  assert.equal(mediaRef('/projects/coffee/slot-0.jpg', 10, 10), '');
  assert.equal(mediaRef(undefined), '');
});

// --- swapAssetSrc ---

test('swapAssetSrc replaces the src of the img at each slot', () => {
  const html = doc(slotImg('A hero shot'), slotImg('A roaster'));
  const out = swapAssetSrc(html, [
    {
      slot: 0, url: MEDIA_0, width: 2688, height: 1512,
    },
    {
      slot: 1, url: MEDIA_1, width: 2688, height: 1512,
    },
  ]);
  assert.ok(out.includes(`src="${MEDIA_0}#width=2688&amp;height=1512"`));
  assert.ok(out.includes(`src="${MEDIA_1}#width=2688&amp;height=1512"`));
  assert.ok(!out.includes('placehold.co'));
});

test('swapAssetSrc preserves document order', () => {
  const html = doc(slotImg('first'), slotImg('second'), slotImg('third'));
  const out = swapAssetSrc(html, [
    { slot: 2, url: 'https://example.com/c.jpg' },
    { slot: 0, url: 'https://example.com/a.jpg' },
    { slot: 1, url: 'https://example.com/b.jpg' },
  ]);
  const srcs = [...out.matchAll(/<img[^>]*src="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(srcs, [
    'https://example.com/a.jpg',
    'https://example.com/b.jpg',
    'https://example.com/c.jpg',
  ]);
});

test('swapAssetSrc leaves an unmatched slot alone', () => {
  const html = doc(slotImg('first'), slotImg('second'));
  const out = swapAssetSrc(html, [{ slot: 1, url: MEDIA_1 }]);
  const srcs = [...out.matchAll(/<img[^>]*src="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(srcs, [PLACEHOLDER, MEDIA_1]);
});

test('swapAssetSrc ignores a replacement for a slot the doc does not have', () => {
  const html = doc(slotImg('only one'));
  const out = swapAssetSrc(html, [
    { slot: 0, url: MEDIA_0 },
    { slot: 7, url: MEDIA_1 },
  ]);
  assert.equal(out, doc(slotImg('only one', MEDIA_0)));
});

test('swapAssetSrc preserves alt and every other attribute on the tag', () => {
  const html = '<p><img loading="lazy" src="https://placehold.co/1600x900" '
    + 'alt="A hero shot of green beans" class="hero" data-slot="0"></p>';
  const out = swapAssetSrc(html, [{ slot: 0, url: MEDIA_0 }]);
  assert.equal(
    out,
    `<p><img loading="lazy" src="${MEDIA_0}" `
    + 'alt="A hero shot of green beans" class="hero" data-slot="0"></p>',
  );
});

test('swapAssetSrc keys a slot by its index among ALL imgs, not the placeholders', () => {
  // Slot 0 was already swapped in an earlier run; slot 1 is still a placeholder.
  const html = doc(slotImg('done', MEDIA_0), slotImg('todo'));
  const out = swapAssetSrc(html, [{ slot: 1, url: MEDIA_1 }]);
  const srcs = [...out.matchAll(/<img[^>]*src="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(srcs, [MEDIA_0, MEDIA_1]);
});

test('swapAssetSrc escapes & so the URL is not read as an entity boundary', () => {
  const url = 'https://content.da.live/o/s/a.jpg?a=1&b=2';
  const out = swapAssetSrc('<img src="x" alt="y">', [{
    slot: 0, url, width: 8, height: 4,
  }]);
  assert.equal(out, '<img src="https://content.da.live/o/s/a.jpg?a=1&amp;b=2#width=8&amp;height=4" alt="y">');
});

test('swapAssetSrc changes nothing when there is nothing usable to swap', () => {
  const html = doc(slotImg('first'));
  assert.equal(swapAssetSrc(html, []), html);
  assert.equal(swapAssetSrc(html, null), html);
  assert.equal(swapAssetSrc(html, [{ slot: 0, url: '' }]), html);
  assert.equal(swapAssetSrc(html, [{ slot: 'hero', url: MEDIA_0 }]), html);
});

test('swapAssetSrc handles a non-string doc without throwing', () => {
  assert.equal(swapAssetSrc(undefined, [{ slot: 0, url: MEDIA_0 }]), '');
});

test('swapAssetSrc touches only the img tags, never the rest of the markup', () => {
  const html = '<div><h1>Green &amp; gold</h1><p><a href="/buy">Buy</a></p>'
    + `<p>${slotImg('hero')}</p><p>src="not-a-tag"</p></div>`;
  const out = swapAssetSrc(html, [{ slot: 0, url: MEDIA_0 }]);
  assert.equal(out, html.replace(PLACEHOLDER, MEDIA_0));
});

// --- fetchAssetBytes ---

const blobOf = (type = 'image/jpeg') => new Blob(['bytes'], { type });

test('fetchAssetBytes reads the presigned image straight from the browser', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, blob: async () => blobOf() };
  };
  const { blob, error } = await fetchAssetBytes('https://firefly.example/a.jpg', fetchImpl);
  assert.equal(error, null);
  assert.equal(blob.type, 'image/jpeg');
  assert.deepEqual(calls, ['https://firefly.example/a.jpg']);
});

test('fetchAssetBytes reports an expired presigned URL as a soft error', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, statusText: 'Forbidden' });
  const { blob, error } = await fetchAssetBytes('https://firefly.example/a.jpg', fetchImpl);
  assert.equal(blob, null);
  assert.match(error, /403 Forbidden/);
});

test('fetchAssetBytes never throws', async () => {
  const fetchImpl = async () => { throw new Error('network down'); };
  const { error } = await fetchAssetBytes('https://firefly.example/a.jpg', fetchImpl);
  assert.match(error, /network down/);
  assert.match((await fetchAssetBytes('')).error, /no generated image/);
});

// --- uploadAsset ---

test('uploadAsset posts the blob to DA and answers with the permanent URL', async () => {
  const calls = [];
  const daFetch = async (url, opts) => {
    calls.push({ url, method: opts.method, data: opts.body.get('data') });
    return { ok: true, json: async () => ({ contentUrl: MEDIA_0 }) };
  };
  const { url, error } = await uploadAsset(daFetch, 'bpauli', 'frescopa', '/projects/coffee/slot-0.jpg', blobOf());
  assert.equal(error, null);
  assert.equal(url, MEDIA_0);
  assert.equal(calls[0].url, 'https://admin.da.live/source/bpauli/frescopa/projects/coffee/slot-0.jpg');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].data.type, 'image/jpeg');
});

test('uploadAsset falls back to the DA content URL when the response has none', async () => {
  const daFetch = async () => ({ ok: true, json: async () => ({}) });
  const { url } = await uploadAsset(daFetch, 'bpauli', 'frescopa', '/projects/coffee/slot-0.jpg', blobOf());
  assert.equal(url, MEDIA_0);
});

test('uploadAsset degrades to a soft error', async () => {
  const daFetch = async () => ({ ok: false, status: 401, statusText: 'Unauthorized' });
  const { url, error } = await uploadAsset(daFetch, 'bpauli', 'frescopa', '/p/a.jpg', blobOf());
  assert.equal(url, '');
  assert.match(error, /401 Unauthorized/);
  assert.match((await uploadAsset(null, 'bpauli', 'frescopa', '/p/a.jpg', blobOf())).error, /DA context/);
  assert.match((await uploadAsset(daFetch, 'bpauli', 'frescopa', '/p/a.jpg', null)).error, /image bytes/);
});

// --- storeAsset / storeAssets ---

const asset = (slot, extra = {}) => ({
  id: `a${slot}`,
  slot,
  alt: `Slot ${slot}`,
  prompt: 'a prompt',
  status: 'Generated',
  sourceUrl: `https://firefly.example/${slot}.jpg`,
  mediaUrl: '',
  model: 'image4_standard',
  aspect: '16:9',
  ...extra,
});

const okDa = (urls = []) => async (url) => {
  urls.push(url);
  return { ok: true, json: async () => ({}) };
};

test('storeAsset gives one asset a permanent DA home', async () => {
  const urls = [];
  const row = await storeAsset(
    okDa(urls),
    { org: 'bpauli', site: 'frescopa', slug: 'coffee' },
    asset(0),
    async () => ({ ok: true, blob: async () => blobOf() }),
  );
  assert.equal(row.error, null);
  assert.equal(row.mediaUrl, MEDIA_0);
  assert.equal(row.alt, 'Slot 0');
  assert.deepEqual(urls, ['https://admin.da.live/source/bpauli/frescopa/projects/coffee/slot-0.jpg']);
});

test('storeAsset keeps a stored mediaUrl when the source has expired', async () => {
  const row = await storeAsset(
    okDa(),
    { org: 'bpauli', site: 'frescopa', slug: 'coffee' },
    asset(0, { mediaUrl: MEDIA_0 }),
    async () => ({ ok: false, status: 403, statusText: 'Forbidden' }),
  );
  assert.equal(row.mediaUrl, MEDIA_0);
  assert.equal(row.error, null);
});

test('storeAsset reports a slot that has neither a source nor a stored copy', async () => {
  const row = await storeAsset(
    okDa(),
    { org: 'bpauli', site: 'frescopa', slug: 'coffee' },
    asset(0, { sourceUrl: '', status: 'Failed' }),
  );
  assert.equal(row.mediaUrl, '');
  assert.match(row.error, /no generated image/);
});

test('storeAssets stores every slot in slot order', async () => {
  const urls = [];
  const rows = await storeAssets(
    okDa(urls),
    { org: 'bpauli', site: 'frescopa', slug: 'coffee' },
    [asset(1), asset(0)],
    async () => ({ ok: true, blob: async () => blobOf() }),
  );
  assert.deepEqual(rows.map((r) => r.slot), [0, 1]);
  assert.deepEqual(rows.map((r) => r.mediaUrl), [MEDIA_0, MEDIA_1]);
});

// --- writePageDoc / previewPage ---

test('writePageDoc posts the whole doc back to DA unchanged', async () => {
  let sent = null;
  const daFetch = async (url, opts) => {
    sent = { url, method: opts.method, data: opts.body.get('data') };
    return { ok: true };
  };
  const html = doc(slotImg('hero', MEDIA_0));
  const { ok, error } = await writePageDoc(daFetch, 'bpauli', 'frescopa', '/coffee-guide', html);
  assert.ok(ok);
  assert.equal(error, null);
  assert.equal(sent.url, 'https://admin.da.live/source/bpauli/frescopa/coffee-guide.html');
  assert.equal(sent.method, 'POST');
  assert.equal(await sent.data.text(), html);
  assert.equal(sent.data.type, 'text/html');
});

test('writePageDoc degrades to a soft error', async () => {
  const daFetch = async () => ({ ok: false, status: 403, statusText: 'Forbidden' });
  const { ok, error } = await writePageDoc(daFetch, 'bpauli', 'frescopa', '/x', doc(slotImg('a')));
  assert.equal(ok, false);
  assert.match(error, /403 Forbidden/);
});

test('previewPage re-triggers the aem.page preview for the page path', async () => {
  const calls = [];
  const daFetch = async (url, opts) => {
    calls.push({ url, method: opts.method });
    return { ok: true };
  };
  assert.equal(await previewPage(daFetch, 'bpauli', 'frescopa', '/coffee-guide'), null);
  assert.deepEqual(calls, [{
    url: 'https://admin.hlx.page/preview/bpauli/frescopa/main/coffee-guide',
    method: 'POST',
  }]);
});

test('previewPage keeps the saved page when the preview fails', async () => {
  const daFetch = async () => { throw new Error('offline'); };
  assert.match(await previewPage(daFetch, 'bpauli', 'frescopa', '/x'), /preview failed: offline/);
});

// --- swapAssetsIntoPage ---

const PAGE = doc(slotImg('A hero shot'), slotImg('A roaster'));

// A DA that answers the page read, the asset uploads, the project record read,
// and every write - recording what it was asked to do.
function fakeDa({ page = PAGE, project = null } = {}) {
  const calls = [];
  const record = project || {
    ':type': 'multi-sheet',
    ':names': ['meta', 'assets'],
    meta: { data: [{ slug: 'coffee', title: 'Coffee', template: 'SEO' }] },
    assets: { data: [] },
  };
  const daFetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body });
    if (url.endsWith('/coffee-guide.html') && !opts.method) {
      return { ok: true, text: async () => page };
    }
    if (url.endsWith('/projects/coffee.json') && !opts.method) {
      return { ok: true, json: async () => record };
    }
    return { ok: true, json: async () => ({}), text: async () => '' };
  };
  return { daFetch, calls };
}

const ctx = { org: 'bpauli', repo: 'frescopa' };
const bytes = async () => ({ ok: true, blob: async () => blobOf() });

test('swapAssetsIntoPage swaps every slot, writes the doc back and previews once', async () => {
  const { daFetch, calls } = fakeDa();
  const out = await swapAssetsIntoPage(ctx, daFetch, {
    slug: 'coffee', path: '/coffee-guide', assets: [asset(0), asset(1)],
  }, bytes);

  assert.equal(out.status, 'Swapped');
  assert.equal(out.error, null);
  assert.equal(out.swapped, 2);
  assert.equal(out.path, '/coffee-guide');
  assert.equal(out.previewUrl, 'https://main--frescopa--bpauli.aem.page/coffee-guide');
  assert.deepEqual(out.assets.map((r) => r.mediaUrl), [MEDIA_0, MEDIA_1]);

  const previews = calls.filter((c) => c.url.startsWith('https://admin.hlx.page/preview/'));
  assert.equal(previews.length, 1, 'one preview for the whole page, not one per slot');
  assert.equal(previews[0].url, 'https://admin.hlx.page/preview/bpauli/frescopa/main/coffee-guide');

  const write = calls.find((c) => c.method === 'POST' && c.url.endsWith('/coffee-guide.html'));
  const saved = await write.body.get('data').text();
  assert.ok(saved.includes(`src="${MEDIA_0}#width=2688&amp;height=1512"`));
  assert.ok(saved.includes(`src="${MEDIA_1}#width=2688&amp;height=1512"`));
  assert.ok(saved.includes('alt="A hero shot"'), 'the alt survives the swap');
  assert.ok(!saved.includes('placehold.co'));
  assert.ok(saved.startsWith('<body>'), 'the Stage 4 page envelope survives');
});

test('swapAssetsIntoPage records each slot mediaUrl in the assets sheet', async () => {
  const { daFetch, calls } = fakeDa();
  await swapAssetsIntoPage(ctx, daFetch, {
    slug: 'coffee', path: '/coffee-guide', assets: [asset(0), asset(1)],
  }, bytes);
  const save = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/projects/coffee.json')).pop();
  const stored = JSON.parse(await save.body.get('data').text());
  assert.deepEqual(stored.assets.data.map((r) => r.mediaUrl), [MEDIA_0, MEDIA_1]);
  assert.deepEqual(stored.assets.data.map((r) => r.sourceUrl), [
    'https://firefly.example/0.jpg', 'https://firefly.example/1.jpg',
  ]);
});

test('swapAssetsIntoPage lands the slots that worked and reports the one that did not', async () => {
  const { daFetch, calls } = fakeDa();
  const oneFails = async (url) => (url.endsWith('/1.jpg')
    ? { ok: false, status: 403, statusText: 'Forbidden' }
    : { ok: true, blob: async () => blobOf() });
  const out = await swapAssetsIntoPage(ctx, daFetch, {
    slug: 'coffee', path: '/coffee-guide', assets: [asset(0), asset(1)],
  }, oneFails);

  assert.equal(out.status, 'Swapped');
  assert.equal(out.swapped, 1);
  assert.match(out.error, /403 Forbidden/);
  const write = calls.find((c) => c.method === 'POST' && c.url.endsWith('/coffee-guide.html'));
  const saved = await write.body.get('data').text();
  assert.ok(saved.includes(`src="${MEDIA_0}`), 'slot 0 swapped');
  assert.ok(saved.includes(PLACEHOLDER), 'slot 1 keeps its placeholder');
});

test('swapAssetsIntoPage never throws on a missing context or page', async () => {
  const { daFetch } = fakeDa();
  const rows = [asset(0)];
  const noCtx = await swapAssetsIntoPage({}, daFetch, { slug: 'coffee', path: '/p', assets: rows });
  assert.equal(noCtx.status, 'Failed');
  assert.match(noCtx.error, /DA context/);

  const noPath = await swapAssetsIntoPage(ctx, daFetch, { slug: 'coffee', path: '', assets: rows });
  assert.match(noPath.error, /no generated page/);

  const noAssets = await swapAssetsIntoPage(ctx, daFetch, { slug: 'coffee', path: '/p', assets: [] });
  assert.match(noAssets.error, /Generate the images first/);
});

test('swapAssetsIntoPage does not write the page when no image could be stored', async () => {
  const { daFetch, calls } = fakeDa();
  const out = await swapAssetsIntoPage(ctx, daFetch, {
    slug: 'coffee', path: '/coffee-guide', assets: [asset(0)],
  }, async () => ({ ok: false, status: 403, statusText: 'Forbidden' }));

  assert.equal(out.status, 'Failed');
  assert.match(out.error, /403 Forbidden/);
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/coffee-guide.html')).length, 0);
  assert.equal(calls.filter((c) => c.url.startsWith('https://admin.hlx.page/preview/')).length, 0);
});
