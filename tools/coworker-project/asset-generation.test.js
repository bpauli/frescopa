import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aspectRatio,
  extractSlots,
  readPageDoc,
  buildAssetPrompt,
  fireflySize,
  buildRequestBody,
  buildGenerationPrompt,
  parseAssetAnswer,
  generateAsset,
  generateAssets,
  ASSET_TIMEOUT_MS,
} from './asset-generation.js';

// A Stage 4 page doc, as page-generation.js writes it and DA hands it back.
const PLACEHOLDER = 'https://placehold.co/1600x900/e9e9e9/6b6b6b?text=Green%20beans';
const slotImg = (alt, src = PLACEHOLDER) => `<img src="${src}" alt="${alt}">`;

const DIRECTION = {
  visualStyle: { name: 'Warm Editorial', description: 'Natural light, shallow depth of field' },
  colorPalette: {
    name: 'Roasted Earth',
    description: 'Warm browns and greens',
    colors: ['#6b4423', '#c9a227', '#3f5e3a'],
  },
};

// --- aspectRatio ---

test('aspectRatio reduces a pixel geometry to a W:H ratio', () => {
  assert.equal(aspectRatio(1600, 900), '16:9');
  assert.equal(aspectRatio(2688, 1512), '16:9');
  assert.equal(aspectRatio(2688, 1536), '7:4');
  assert.equal(aspectRatio(1024, 1024), '1:1');
  assert.equal(aspectRatio(896, 1152), '7:9');
});

test('aspectRatio returns an empty string for an unusable geometry', () => {
  assert.equal(aspectRatio(0, 900), '');
  assert.equal(aspectRatio(1600, -1), '');
  assert.equal(aspectRatio('wide', 'tall'), '');
  assert.equal(aspectRatio(undefined, undefined), '');
});

// --- extractSlots ---

test('extractSlots returns every placeholder img in document order', () => {
  const html = `<div><h1>Green coffee beans</h1><p>${slotImg('A hero shot of green beans')}</p></div>`
    + `<div><h2>How we roast</h2><p>${slotImg('A roaster tipping beans into a drum')}</p></div>`;
  assert.deepEqual(extractSlots(html), [
    {
      slot: 0, alt: 'A hero shot of green beans', src: PLACEHOLDER, aspect: '16:9',
    },
    {
      slot: 1, alt: 'A roaster tipping beans into a drum', src: PLACEHOLDER, aspect: '16:9',
    },
  ]);
});

test('extractSlots keeps the slot key stable once a slot has been swapped for a real asset', () => {
  // Slot 0 already carries a generated image; the placeholder left is still slot 1,
  // so a later read identifies the same slot and Regenerate hits one assets row.
  const html = `<p>${slotImg('Swapped', 'https://content.da.live/bpauli/frescopa/hero.jpg')}</p>`
    + `<p>${slotImg('Still a placeholder')}</p>`;
  const slots = extractSlots(html);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].slot, 1);
  assert.equal(slots[0].alt, 'Still a placeholder');
});

test('extractSlots unescapes the alt text Stage 4 escaped into the doc', () => {
  const html = slotImg('A barista&#39;s hand &amp; a &quot;flat white&quot;');
  assert.equal(extractSlots(html)[0].alt, 'A barista\'s hand & a "flat white"');
});

test('extractSlots reads single-quoted and self-closing tags, and a missing alt', () => {
  const html = `<img src='${PLACEHOLDER}' />`;
  assert.deepEqual(extractSlots(html), [{
    slot: 0, alt: '', src: PLACEHOLDER, aspect: '16:9',
  }]);
});

test('extractSlots derives the aspect from the placeholder geometry', () => {
  const square = 'https://placehold.co/800x800/e9e9e9/6b6b6b?text=x';
  const portrait = 'https://placehold.co/900x1600/e9e9e9/6b6b6b';
  const html = `${slotImg('Square', square)}${slotImg('Portrait', portrait)}`;
  assert.deepEqual(extractSlots(html).map((s) => s.aspect), ['1:1', '9:16']);
});

test('extractSlots falls back to 16:9 when the placeholder carries no geometry', () => {
  assert.equal(extractSlots(slotImg('No size', 'https://placehold.co/grey?text=x'))[0].aspect, '16:9');
});

test('extractSlots returns an empty array for a page with no placeholders', () => {
  assert.deepEqual(extractSlots('<div><h1>Text only</h1></div>'), []);
  assert.deepEqual(extractSlots(''), []);
  assert.deepEqual(extractSlots(null), []);
});

// --- readPageDoc ---

const okFetch = (html) => async () => ({ ok: true, status: 200, text: async () => html });

test('readPageDoc reads the page doc from the DA source API', async () => {
  const calls = [];
  const daFetch = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, text: async () => '<div>page</div>' };
  };
  const result = await readPageDoc(daFetch, 'bpauli', 'frescopa', '/drafts/green-beans');
  assert.deepEqual(result, { html: '<div>page</div>', error: null });
  assert.deepEqual(calls, ['https://admin.da.live/source/bpauli/frescopa/drafts/green-beans.html']);
});

test('readPageDoc derives the page path the way Stage 4 wrote it', async () => {
  const calls = [];
  const daFetch = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, text: async () => '' };
  };
  await readPageDoc(daFetch, 'bpauli', 'frescopa', 'Drafts/Green Beans.html');
  assert.deepEqual(calls, ['https://admin.da.live/source/bpauli/frescopa/drafts/green-beans.html']);
});

test('readPageDoc reports a failed read as a soft error, never a throw', async () => {
  const notFound = await readPageDoc(
    async () => ({ ok: false, status: 404, statusText: 'Not Found' }),
    'bpauli',
    'frescopa',
    '/drafts/x',
  );
  assert.equal(notFound.html, '');
  assert.match(notFound.error, /404 Not Found/);

  const offline = await readPageDoc(async () => { throw new Error('offline'); }, 'bpauli', 'frescopa', '/drafts/x');
  assert.deepEqual(offline, { html: '', error: 'Could not read the page: offline' });
});

test('readPageDoc reports missing context and a project with no page yet', async () => {
  assert.deepEqual(
    await readPageDoc(okFetch('<div/>'), '', 'frescopa', '/drafts/x'),
    { html: '', error: 'Missing DA context.' },
  );
  assert.deepEqual(
    await readPageDoc(null, 'bpauli', 'frescopa', '/drafts/x'),
    { html: '', error: 'Missing DA context.' },
  );
  assert.deepEqual(
    await readPageDoc(okFetch('<div/>'), 'bpauli', 'frescopa', ''),
    { html: '', error: 'The project has no generated page yet.' },
  );
});

// --- buildAssetPrompt ---

test('buildAssetPrompt combines the slot alt, the visual style, the palette and the crop', () => {
  const prompt = buildAssetPrompt(
    { alt: 'Green coffee beans spilling from a burlap sack', aspect: '16:9' },
    DIRECTION,
  );
  assert.match(prompt, /^Green coffee beans spilling from a burlap sack\./);
  assert.match(prompt, /Visual style: Warm Editorial - Natural light, shallow depth of field\./);
  assert.match(prompt, /Colour palette: Roasted Earth - Warm browns and greens\./);
  assert.match(prompt, /Use these colours: #6b4423, #c9a227, #3f5e3a\./);
  assert.match(prompt, /Composed for a 16:9 landscape crop\./);
  assert.match(prompt, /No text, no lettering, no watermark, no logo\./);
});

test('buildAssetPrompt names the crop orientation', () => {
  assert.match(buildAssetPrompt({ alt: 'A cup', aspect: '1:1' }), /a 1:1 square crop/);
  assert.match(buildAssetPrompt({ alt: 'A cup', aspect: '9:16' }), /a 9:16 portrait crop/);
  assert.match(buildAssetPrompt({ alt: 'A cup', aspect: '16:9' }), /a 16:9 landscape crop/);
});

test('buildAssetPrompt works with no creative direction and with a partial one', () => {
  const bare = buildAssetPrompt({ alt: 'A cup of coffee', aspect: '16:9' });
  assert.match(bare, /^A cup of coffee\./);
  assert.doesNotMatch(bare, /Visual style|Colour palette/);

  const styleOnly = buildAssetPrompt({ alt: 'A cup', aspect: '16:9' }, { visualStyle: { name: 'Minimal' } });
  assert.match(styleOnly, /Visual style: Minimal\./);
  assert.doesNotMatch(styleOnly, /Colour palette/);

  const colorsOnly = buildAssetPrompt({ alt: 'A cup', aspect: '16:9' }, { colorPalette: { colors: ['#fff'] } });
  assert.match(colorsOnly, /Colour palette: Use these colours: #fff\./);
});

test('buildAssetPrompt falls back to a generic subject and the default crop', () => {
  const prompt = buildAssetPrompt({});
  assert.match(prompt, /^An editorial photograph for a marketing web page\./);
  assert.match(prompt, /Composed for a 16:9 landscape crop\./);
});

test('buildAssetPrompt stays inside Firefly\'s 1024 character prompt limit', () => {
  const prompt = buildAssetPrompt({ alt: 'beans '.repeat(400), aspect: '16:9' }, DIRECTION);
  assert.equal(prompt.length, 1024);
  assert.match(prompt, /\.\.\.$/);
});

test('buildAssetPrompt never doubles the punctuation of an authored sentence', () => {
  const prompt = buildAssetPrompt(
    { alt: 'A barista pouring a latte.', aspect: '16:9' },
    {
      visualStyle: { name: 'Botanical Editorial', description: 'Magazine-quality photography.' },
      colorPalette: { name: 'Earthy Roastery', description: 'Grounded browns and deep greens.' },
    },
  );
  assert.doesNotMatch(prompt, /\.\./);
  assert.match(prompt, /^A barista pouring a latte\. Visual style: Botanical Editorial - Magazine-quality photography\. /);
});

test('buildAssetPrompt is pure: the same input gives the same prompt', () => {
  const slot = { alt: 'A roaster at work', aspect: '16:9' };
  assert.equal(buildAssetPrompt(slot, DIRECTION), buildAssetPrompt(slot, DIRECTION));
});

// --- fireflySize / buildRequestBody ---

test('fireflySize pins true 16:9 to 2688x1512, not the 7:4 AO picks for itself', () => {
  assert.deepEqual(fireflySize('16:9'), { width: 2688, height: 1512 });
});

test('fireflySize picks the largest allow-listed pair closest to the crop', () => {
  assert.deepEqual(fireflySize('1:1'), { width: 2048, height: 2048 });
  assert.deepEqual(fireflySize('4:3'), { width: 2304, height: 1792 });
  assert.deepEqual(fireflySize('3:4'), { width: 1792, height: 2304 });
  assert.deepEqual(fireflySize('9:16'), { width: 1440, height: 2560 });
});

test('fireflySize falls back to the 16:9 default for an unusable aspect', () => {
  assert.deepEqual(fireflySize(''), { width: 2688, height: 1512 });
  assert.deepEqual(fireflySize('wide'), { width: 2688, height: 1512 });
  assert.deepEqual(fireflySize(undefined), { width: 2688, height: 1512 });
});

test('buildRequestBody pins every Firefly parameter the app must not let AO choose', () => {
  assert.deepEqual(buildRequestBody('A cup of coffee', '16:9'), {
    prompt: 'A cup of coffee',
    numVariations: 1,
    contentClass: 'photo',
    size: { width: 2688, height: 1512 },
    'x-model-version': 'image4_standard',
  });
});

test('buildRequestBody never sends a prompt Firefly would reject as too long', () => {
  assert.equal(buildRequestBody('x'.repeat(2000), '1:1').prompt.length, 1024);
});

// --- buildGenerationPrompt ---

const jobsOf = (...slots) => slots.map((slot) => ({
  slot,
  prompt: `prompt ${slot}`,
  aspect: '16:9',
  requestBody: buildRequestBody(`prompt ${slot}`, '16:9'),
}));

test('buildGenerationPrompt hands AO the verbatim requestBody, which AO must not edit', () => {
  const prompt = buildGenerationPrompt(jobsOf(0));
  // A bulleted parameter list loses keys (gate #57), so the object goes over as JSON.
  assert.ok(prompt.includes(JSON.stringify(buildRequestBody('prompt 0', '16:9'))));
  assert.match(prompt, /changing nothing and dropping no key/);
  assert.match(prompt, /sentRequestBody/);
});

test('buildGenerationPrompt asks for the whole page in ONE batched turn', () => {
  const prompt = buildGenerationPrompt(jobsOf(0, 1, 2));
  assert.match(prompt, /There are 3 slots/);
  assert.match(prompt, /Start every slot before you poll any of them/);
  // AO owns the poll loop inside the turn; the app polls nothing.
  assert.match(prompt, /poll Firefly__jobResultV3/);
  assert.match(prompt, /sleep tool between polls/);
  ['Slot 0:', 'Slot 1:', 'Slot 2:'].forEach((s) => assert.ok(prompt.includes(s)));
});

test('buildGenerationPrompt asks for bare JSON, since extractJson parses it directly', () => {
  const prompt = buildGenerationPrompt(jobsOf(0));
  assert.match(prompt, /There is 1 slot/);
  assert.match(prompt, /ONLY valid JSON \(no prose, no markdown fences\)/);
});

// --- parseAssetAnswer ---

const FIREFLY_URL = 'https://pre-signed-firefly-prod.s3-accelerate.amazonaws.com/images/abc?X-Amz-Expires=3600';
const AT = '2026-09-21T12:00:00.000Z';

test('parseAssetAnswer turns an AO answer into one row per slot', () => {
  const rows = parseAssetAnswer({
    assets: [{
      slot: 0,
      status: 'succeeded',
      jobId: 'urn:ff:jobs:epo852211:255bc918',
      sourceUrl: FIREFLY_URL,
      seed: 129626442,
      width: 2688,
      height: 1512,
      description: 'Green beans on linen.',
      sentRequestBody: buildRequestBody('prompt 0', '16:9'),
    }],
  }, jobsOf(0), AT);

  assert.deepEqual(rows, [{
    slot: 0,
    prompt: 'prompt 0',
    aspect: '16:9',
    sourceUrl: FIREFLY_URL,
    model: 'image4_standard',
    description: 'Green beans on linen.',
    seed: 129626442,
    jobId: 'urn:ff:jobs:epo852211:255bc918',
    width: 2688,
    height: 1512,
    createdAt: AT,
    status: 'Generated',
    error: null,
  }]);
});

test('parseAssetAnswer records the model AO actually sent, since the tool reports none', () => {
  const sent = { ...buildRequestBody('prompt 0', '16:9'), 'x-model-version': 'image4_ultra' };
  const [row] = parseAssetAnswer(
    { assets: [{ slot: 0, sourceUrl: FIREFLY_URL, sentRequestBody: sent }] },
    jobsOf(0),
    AT,
  );
  assert.equal(row.model, 'image4_ultra');
});

test('parseAssetAnswer keeps every other slot when one slot fails', () => {
  const rows = parseAssetAnswer({
    assets: [
      { slot: 0, status: 'succeeded', sourceUrl: FIREFLY_URL },
      { slot: 1, status: 'failed', sourceUrl: '' },
    ],
  }, jobsOf(0, 1, 2), AT);

  assert.equal(rows.length, 3);
  assert.equal(rows[0].status, 'Generated');
  assert.equal(rows[1].status, 'Failed');
  assert.match(rows[1].error, /Firefly did not finish this slot: failed/);
  // Slot 2 never came back at all.
  assert.equal(rows[2].status, 'Failed');
  assert.equal(rows[2].sourceUrl, '');
  assert.equal(rows[2].error, 'No image came back for this slot.');
});

test('parseAssetAnswer treats a slot without a usable URL as a soft error', () => {
  const rows = parseAssetAnswer({ assets: [{ slot: 0, status: 'succeeded', sourceUrl: 'not-a-url' }] }, jobsOf(0), AT);
  assert.equal(rows[0].status, 'Failed');
  assert.equal(rows[0].sourceUrl, '');
});

test('parseAssetAnswer accepts a bare array and a single bare object', () => {
  assert.equal(parseAssetAnswer([{ slot: 0, sourceUrl: FIREFLY_URL }], jobsOf(0), AT)[0].status, 'Generated');
  assert.equal(parseAssetAnswer({ sourceUrl: FIREFLY_URL }, jobsOf(0), AT)[0].status, 'Generated');
});

test('parseAssetAnswer survives junk instead of an answer', () => {
  ['', null, 42, 'nope'].forEach((junk) => {
    const rows = parseAssetAnswer(junk, jobsOf(0), AT);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'Failed');
  });
  assert.deepEqual(parseAssetAnswer({ assets: [] }, null, AT), []);
});

// --- generateAssets / generateAsset ---
//
// The happy path needs a live AO turn (see the live verification in the PR);
// what is unit-testable here is the contract that matters to every caller: it
// never throws, and a failure is a row that keeps the slot's placeholder.

test('generateAssets never throws: a missing Coworker context is a soft error row per slot', async () => {
  const rows = await generateAssets({}, [
    { slot: 0, prompt: 'a', aspect: '16:9' },
    { slot: 1, prompt: 'b', aspect: '16:9' },
  ]);
  assert.equal(rows.length, 2);
  rows.forEach((row) => {
    assert.equal(row.status, 'Failed');
    assert.equal(row.sourceUrl, '');
    assert.equal(row.error, 'Missing Coworker context.');
    assert.ok(row.createdAt);
  });
});

test('generateAssets rejects an unusable slot in its own place, before any AO turn', async () => {
  const rows = await generateAssets({ org: 'bpauli', repo: 'frescopa' }, [{ slot: 0, prompt: '   ' }]);
  assert.deepEqual(rows.map((r) => [r.slot, r.status, r.error]), [[0, 'Failed', 'This slot has no prompt.']]);
});

test('generateAssets caps one runaway page and reports the rest as soft errors', async () => {
  const many = Array.from({ length: 14 }, (unused, i) => ({ slot: i, prompt: `p${i}`, aspect: '16:9' }));
  const rows = await generateAssets({}, many);
  assert.equal(rows.length, 14);
  assert.deepEqual(rows.map((r) => r.slot), many.map((s) => s.slot));
  assert.match(rows[13].error, /Only 12 slots can be generated at once\./);
});

test('generateAssets returns rows in slot order, which is document order', async () => {
  const rows = await generateAssets({}, [
    { slot: 2, prompt: 'c', aspect: '16:9' },
    { slot: 0, prompt: '', aspect: '16:9' },
    { slot: 1, prompt: 'b', aspect: '16:9' },
  ]);
  assert.deepEqual(rows.map((r) => r.slot), [0, 1, 2]);
});

test('generateAssets returns nothing for nothing', async () => {
  assert.deepEqual(await generateAssets({ org: 'bpauli', repo: 'frescopa' }, []), []);
  assert.deepEqual(await generateAssets({ org: 'bpauli', repo: 'frescopa' }, null), []);
});

test('generateAsset is the single-slot case and returns one row, never a throw', async () => {
  const row = await generateAsset({}, { slot: 3, prompt: 'a lone slot', aspect: '1:1' });
  assert.equal(row.slot, 3);
  assert.equal(row.aspect, '1:1');
  assert.equal(row.status, 'Failed');
  assert.equal(row.error, 'Missing Coworker context.');

  const empty = await generateAsset({ org: 'bpauli', repo: 'frescopa' });
  assert.equal(empty.slot, 0);
  assert.equal(empty.error, 'This slot has no prompt.');
});

test('the asset timeout is far longer than the 60s askJson default a real turn outruns', () => {
  assert.equal(ASSET_TIMEOUT_MS, 300000);
});
