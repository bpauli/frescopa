import test from 'node:test';
import assert from 'node:assert/strict';

import { ASSET_CHAT_LEAD, composeAssetMessage, composeContext } from './chat-context.js';

const asset = {
  slot: 2,
  alt: 'A barista pouring a flat white on a marble counter',
  description: 'A barista pours milk into an espresso in warm morning light.',
  visualStyle: 'Warm editorial',
  palette: 'Roasted earth',
  aspect: '16:9',
  prompt: 'A barista pouring a flat white. Visual style: Warm editorial.',
};

test('composeContext grounds the rail in the project and the stage', () => {
  const text = composeContext(
    { stage: 'Asset Generation', stageIndex: 5, status: 'In Progress' },
    { meta: { title: 'Coffee guide' } },
  );
  assert.match(text, /Project: Coffee guide\./);
  assert.match(text, /Current stage: Asset Generation \(Stage 5\), status In Progress\./);
});

test('composeAssetMessage hands the rail the facts of one image', () => {
  const text = composeAssetMessage(asset, 'A barista pouring a flat white');
  assert.match(text, /^Image: A barista pouring a flat white$/m);
  assert.match(text, /^Slot: 2 \(its position on the page\)\.$/m);
  assert.match(text, /^ALT text: A barista pouring a flat white on a marble counter$/m);
  assert.match(text, /^What it shows: A barista pours milk/m);
  assert.match(text, /^Look: visual style "Warm editorial", palette "Roasted earth", 16:9 crop\.$/m);
  assert.match(text, /^Prompt it was generated from: A barista pouring a flat white\./m);
});

test('composeAssetMessage leaves out what the row does not carry', () => {
  const text = composeAssetMessage({ slot: 0, alt: 'A green field' });
  assert.equal(text, 'Slot: 0 (its position on the page).\nALT text: A green field');
});

test('composeAssetMessage says nothing about nothing', () => {
  assert.equal(composeAssetMessage(null), '');
  assert.equal(composeAssetMessage({}), '');
});

test('the asset lead frames the hand-over as a change request', () => {
  assert.match(ASSET_CHAT_LEAD, /image/i);
  assert.match(ASSET_CHAT_LEAD, /change/i);
});
