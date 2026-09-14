import test from 'node:test';
import assert from 'node:assert/strict';

import { psiCategories, cleanAssessment, rollupReadiness } from './preflight-contracts.js';

test('psiCategories derives passed/total from scorable audit refs', () => {
  const lighthouseResult = {
    categories: {
      performance: { score: 0.5, auditRefs: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
      accessibility: { score: 0.92, auditRefs: [{ id: 'x' }] },
    },
    audits: {
      a: { score: 1 }, b: { score: 0 }, c: { score: null }, x: { score: 1 },
    },
  };
  const cats = psiCategories(lighthouseResult);
  assert.deepEqual(cats[0], {
    name: 'Web performance', passed: 1, total: 2, score: 50, source: 'psi',
  });
  assert.deepEqual(cats[1], {
    name: 'Accessibility', passed: 1, total: 1, score: 92, source: 'psi',
  });
});

test('psiCategories falls back to score-as-percentage when no audits are scorable', () => {
  const cats = psiCategories({ categories: { seo: { score: 1, auditRefs: [] } } });
  assert.deepEqual(cats, [{
    name: 'SEO', passed: 100, total: 100, score: 100, source: 'psi',
  }]);
});

test('psiCategories skips a category with a missing score', () => {
  const cats = psiCategories({ categories: { 'best-practices': { score: null } } });
  assert.deepEqual(cats, []);
});

test('cleanAssessment coerces, clamps, tags source ai, and defaults total', () => {
  const raw = {
    categories: [
      {
        name: 'LLM visibility', passed: 3, total: 5, score: 60,
      },
      { name: 'Engagement & conversion', score: 75 },
    ],
  };
  assert.deepEqual(cleanAssessment(raw), [
    {
      name: 'LLM visibility', passed: 3, total: 5, score: 60, source: 'ai',
    },
    {
      name: 'Engagement & conversion', passed: 75, total: 100, score: 75, source: 'ai',
    },
  ]);
});

test('cleanAssessment accepts a bare array and clamps out-of-range scores', () => {
  const cats = cleanAssessment([
    { name: 'A', score: 150 },
    { name: 'B', score: -5 },
  ]);
  assert.equal(cats[0].score, 100);
  assert.equal(cats[1].score, 0);
});

test('cleanAssessment de-dupes by name (case-insensitive)', () => {
  const cats = cleanAssessment([{ name: 'LLM visibility', score: 50 }, { name: 'llm visibility', score: 90 }]);
  assert.equal(cats.length, 1);
  assert.equal(cats[0].score, 50);
});

test('rollupReadiness is the rounded mean of category scores', () => {
  assert.equal(rollupReadiness([{ score: 50 }, { score: 90 }, { score: 61 }]), 67);
});

test('rollupReadiness ignores entries without a numeric score and returns 0 when empty', () => {
  assert.equal(rollupReadiness([{ score: 80 }, { name: 'x' }, { score: 'bad' }]), 80);
  assert.equal(rollupReadiness([]), 0);
  assert.equal(rollupReadiness(null), 0);
});
