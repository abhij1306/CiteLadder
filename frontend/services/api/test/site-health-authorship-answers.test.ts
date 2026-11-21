import { describe, expect, it } from 'vitest';

import { extractPageFacts } from '../src/site-health/analysis/facts.ts';

const facts = (html: string) =>
  extractPageFacts(Buffer.from(`<main><h1>Notes</h1>${html}<p>Body.</p></main>`), {
    finalUrl: 'https://example.test/page',
    contentType: 'text/html',
    statusCode: 200,
  });
const page = (html: string) =>
  extractPageFacts(Buffer.from(html), {
    finalUrl: 'https://example.test/page',
    contentType: 'text/html',
    statusCode: 200,
  });

describe('visible author byline', () => {
  it.each([
    [
      'a CSS-module camelCase author container',
      `<div class='editorial-module__oN9t7G__blogHeaderAuthorName'><a href='/authors/jane-doe'>Jane Doe</a></div>`,
    ],
    [
      'a role label printed before the name',
      `<span class='bylineRole'>Author</span><div class='authorName'><a href='/authors/jane-doe'>Jane Doe</a></div>`,
    ],
    [
      'a job title printed after the linked name',
      `<div class='blogHeaderAuthor'><div><a href='/authors/jane-doe'>Jane Doe</a></div><p>Co-Founder</p></div>`,
    ],
  ])('reads the linked name from %s', (_case, byline) => {
    expect(facts(byline).authorship).toMatchObject({
      visible_byline: 'Jane Doe',
      visible_profile_url: '/authors/jane-doe',
    });
  });
});

describe('question answers', () => {
  it('reads a collapsed accordion answer from the served HTML', () => {
    const accordion = (expanded: string) =>
      facts(`<h2>FAQ</h2>
      <button aria-controls='faq-1-panel' aria-expanded='${expanded}'>What is semantic chunking?</button>
      <div id='faq-1-panel' role='region' aria-hidden='true'><p>It splits text where the topic changes.</p></div>`)
        .question_answer_relationships;
    expect(accordion('false')).toMatchObject([
      { answer: 'It splits text where the topic changes.', answer_state: 'available' },
    ]);
    expect(accordion('true')).toMatchObject([
      { answer: '', answer_state: 'unavailable', reason: 'answer_panel_unavailable' },
    ]);
  });

  it('answers a question title from the body past its byline and table of contents', () => {
    const titled = page(`<main><h1>What is content chunking?</h1>
      <div class='byline'><div><img src='/a.jpg'><span><a href='/authors/jane'>Jane Doe</a></span></div>
      <div><span><time datetime='2026-09-30'>Sep 30, 2026</time></span><span>5 min read</span></div></div>
      <div><aside><p>Table of contents</p><nav><a href='#a'>How it works</a><a href='#b'>Why</a>
      <a href='#c'>How to write</a><a href='#d'>Google</a><a href='#e'>FAQ</a></nav></aside>
      <article><div><p>Definition</p><p>Chunking splits a page into passages engines can quote.</p></div>
      <h2>How it works</h2><p>Engines embed passages.</p></article></div></main>`);
    expect(titled.question_answer_relationships).toMatchObject([
      {
        question: 'What is content chunking?',
        answer: 'Chunking splits a page into passages engines can quote.',
        answer_state: 'available',
      },
    ]);
  });
});
