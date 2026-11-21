import {
  ancestors,
  attribute,
  childElements,
  elements,
  parentElement,
  textContent,
  type HtmlElement,
  type HtmlNode,
} from '../../web-evidence/html.ts';
import { scalarText } from '../../text-order.ts';
import { isMetadataOrCta } from './copy.ts';
import { analysisPolicy, limits, regionPolicy, squash } from './policy.ts';
import { outsideContainers, pageOwned } from './regions.ts';

export type QuestionAnswer = {
  question: string;
  answer: string;
  source: string;
  answer_state: string;
  reason: string;
};
type Scope = { region: HtmlNode; containers: ReadonlySet<HtmlElement> };

const BOUNDARY_TAGS = new Set(['article', 'section', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dt']);
const ANSWER_TAGS = new Set(['p', 'dd', 'div', 'span', 'li']);
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dt']);
const AUXILIARY = 'is|are|was|were|do|does|did|can|could|will|would|should|has|have';
const QUESTION_FORM = new RegExp(
  String.raw`^(?:(?:what|why|how|where|when|who|which)\s+(?:${AUXILIARY})\b|(?:${AUXILIARY})\s+.+\?$)`,
  'u',
);
const DEFINITION_PREFIXES = ['definition ', 'definition of ', 'meaning of ', 'define '];
const maxPairs = regionPolicy.page_owned_max_question_answer_pairs;
const maxHops = analysisPolicy.facts.answer_first_max_hops;

export function isAnswerHeading(text: string) {
  const normalized = squash(text.toLowerCase());
  if (!normalized) return false;
  return (
    normalized.endsWith('?') ||
    QUESTION_FORM.test(normalized) ||
    DEFINITION_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

export function observedQuestionCount(value: unknown) {
  if (!Array.isArray(value)) return 0;
  const questions = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const question = scalarText((item as { question?: unknown }).question);
    if (isAnswerHeading(question)) questions.add(squash(question.toLowerCase()));
  }
  questions.delete('');
  return questions.size;
}

const owned = (node: HtmlElement, scope: Scope) =>
  node !== scope.region && pageOwned(node, scope.region, scope.containers);

function answerCandidate(node: HtmlElement, scope: Scope) {
  if (!ANSWER_TAGS.has(node.tagName) || !owned(node, scope) || isMetadataOrCta(node)) return '';
  if (node.tagName === 'div')
    for (const inner of elements(node))
      if (inner !== node && (HEADING_TAGS.has(inner.tagName) || inner.tagName === 'details'))
        return '';
  return squash(textContent(node));
}

function firstChildAnswer(node: HtmlElement, scope: Scope) {
  for (const child of childElements(node)) {
    const nested = ['ul', 'ol'].includes(child.tagName)
      ? childElements(child).filter((item) => item.tagName === 'li')
      : [child];
    for (const candidate of nested) {
      const answer = answerCandidate(candidate, scope);
      if (answer) return answer;
    }
  }
  return '';
}

function* followingInScope(heading: HtmlElement, scope: Scope): Generator<HtmlElement> {
  const answerScope =
    [...ancestors(heading)].find((node) => ['article', 'section'].includes(node.tagName)) ??
    scope.region;
  let seen = false;
  for (const node of elements(scope.region)) {
    if (node === heading) {
      seen = true;
      continue;
    }
    if (!seen) continue;
    const chain = new Set(ancestors(node));
    if (chain.has(heading)) continue;
    if (answerScope !== scope.region && !chain.has(answerScope as HtmlElement)) return;
    yield node;
  }
}

function siblingAnswer(heading: HtmlElement, scope: Scope) {
  const parent = parentElement(heading);
  const siblings = parent ? childElements(parent) : [];
  let hops = 0;
  for (const sibling of siblings.slice(siblings.indexOf(heading) + 1)) {
    if (++hops > maxHops || BOUNDARY_TAGS.has(sibling.tagName)) break;
    const answer = answerCandidate(sibling, scope);
    if (answer) return answer;
  }
  return '';
}

function followingAnswer(heading: HtmlElement, scope: Scope) {
  let hops = 0;
  for (const node of followingInScope(heading, scope)) {
    if (HEADING_TAGS.has(node.tagName)) break;
    if (passedOver(node)) continue;
    if (++hops > maxHops) break;
    const answer = answerCandidate(node, scope);
    if (answer && !LABEL.test(answer)) return answer;
  }
  return '';
}

const associatedAnswer = (heading: HtmlElement, scope: Scope) =>
  siblingAnswer(heading, scope) || followingAnswer(heading, scope);

const LABEL = /^\p{L}+(?:\s\p{L}+){0,2}$/u;
const SKIPPED_TAGS = new Set(['aside', 'nav']);
const skipped = (node: HtmlElement) => SKIPPED_TAGS.has(node.tagName);
const ownText = (node: HtmlElement) =>
  node.childNodes.some(
    (child) => child.nodeName === '#text' && 'value' in child && child.value.trim(),
  );
const passedOver = (node: HtmlElement) =>
  skipped(node) || [...ancestors(node)].some(skipped) || !ownText(node);

function boundedQuestion(question: string) {
  const limit = limits.heading_chars;
  if (question.length <= limit) return question;
  if (question.endsWith('?')) return `${question.slice(0, limit - 1).trimEnd()}?`;
  return question.slice(0, limit).trimEnd();
}

class Relationships {
  readonly items: QuestionAnswer[] = [];
  readonly #seen = new Set<string>();
  get full() {
    return this.items.length >= maxPairs;
  }
  add(question: string, answer: string, source: string, state?: string, reason = '') {
    const text = squash(question);
    const normalizedAnswer = squash(answer);
    const bounded = boundedQuestion(text);
    const identity = text.toLowerCase();
    if (this.full || !isAnswerHeading(bounded) || this.#seen.has(identity)) return;
    this.#seen.add(identity);
    this.items.push({
      question: bounded,
      answer: normalizedAnswer.slice(0, limits.first_answer_chars),
      source,
      answer_state: state ?? (normalizedAnswer ? 'available' : 'missing'),
      reason: reason || (normalizedAnswer ? '' : 'answer_content_missing'),
    });
  }
}

function detailsRelationships(scope: Scope, found: Relationships) {
  let scanned = 0;
  for (const details of elements(scope.region, 'details')) {
    if (++scanned > regionPolicy.max_containers_scanned || found.full) return;
    if (!owned(details, scope)) continue;
    const summary = childElements(details).find((child) => child.tagName === 'summary');
    if (!summary) continue;
    let answer = '';
    for (const child of childElements(details)) {
      if (child === summary || child.tagName === 'details') continue;
      answer = answerCandidate(child, scope) || firstChildAnswer(child, scope);
      if (answer) break;
    }
    found.add(textContent(summary), answer, 'details');
  }
}

function controlTarget(control: HtmlElement) {
  const target = attribute(control, 'aria-controls').trim();
  const expanded = attribute(control, 'aria-expanded').trim().toLowerCase();
  const isButton =
    control.tagName === 'button' || attribute(control, 'role').trim().toLowerCase() === 'button';
  if (!target || /\s/u.test(target) || !['true', 'false'].includes(expanded) || !isButton)
    return null;
  return target;
}

function collapsedPanel(control: HtmlElement, panel: HtmlElement, scope: Scope) {
  if (attribute(control, 'aria-expanded').trim().toLowerCase() !== 'false') return false;
  if (!outsideContainers(panel, scope.containers)) return false;
  const chain: readonly HtmlNode[] = [...ancestors(panel)];
  return chain.includes(scope.region);
}

function panelState(
  target: string,
  control: HtmlElement,
  panels: Map<string, HtmlElement>,
  duplicates: Set<string>,
  scope: Scope,
): [string, string, string] {
  if (duplicates.has(target)) return ['', 'unavailable', 'answer_panel_ambiguous'];
  const panel = panels.get(target);
  if (!panel || panel === control) return ['', 'unavailable', 'answer_panel_missing'];
  if (!owned(panel, scope)) {
    if (!collapsedPanel(control, panel, scope))
      return ['', 'unavailable', 'answer_panel_unavailable'];
    const answer = squash(textContent(panel));
    return answer ? [answer, 'available', ''] : ['', 'missing', 'answer_content_missing'];
  }
  const answer = answerCandidate(panel, scope) || firstChildAnswer(panel, scope);
  return answer ? [answer, 'available', ''] : ['', 'missing', 'answer_content_missing'];
}

function ariaRelationships(scope: Scope, found: Relationships) {
  const nodes = [...elements(scope.region)].slice(0, regionPolicy.max_containers_scanned);
  const panels = new Map<string, HtmlElement>();
  const duplicates = new Set<string>();
  for (const node of nodes) {
    const id = attribute(node, 'id').trim();
    if (!id) continue;
    if (panels.has(id)) duplicates.add(id);
    else panels.set(id, node);
  }
  for (const control of nodes) {
    if (found.full) return;
    if (!owned(control, scope)) continue;
    const target = controlTarget(control);
    if (target === null) continue;
    const [answer, state, reason] = panelState(target, control, panels, duplicates, scope);
    found.add(textContent(control), answer, 'aria_controls', state, reason);
  }
}

function headingRelationships(scope: Scope, found: Relationships) {
  let scanned = 0;
  let accepted = 0;
  for (const heading of elements(scope.region)) {
    if (!HEADING_TAGS.has(heading.tagName) || heading === scope.region) continue;
    if (++scanned > regionPolicy.max_containers_scanned || found.full) return;
    if (!owned(heading, scope)) continue;
    const question = textContent(heading);
    if (!isAnswerHeading(question)) continue;
    if (++accepted > limits.headings_kept) return;
    found.add(question, associatedAnswer(heading, scope), 'heading');
  }
}

export function questionAnswerRelationships(scope: Scope): QuestionAnswer[] {
  const found = new Relationships();
  detailsRelationships(scope, found);
  ariaRelationships(scope, found);
  headingRelationships(scope, found);
  return found.items;
}

export function directAnswer(scope: Scope) {
  let accepted = 0;
  for (const heading of elements(scope.region)) {
    if (!['h1', 'h2', 'h3', 'dt'].includes(heading.tagName) || heading === scope.region) continue;
    if (!owned(heading, scope)) continue;
    if (++accepted > limits.headings_kept) break;
    if (!isAnswerHeading(textContent(heading))) continue;
    const answer = associatedAnswer(heading, scope);
    if (answer) return answer.slice(0, limits.first_answer_chars);
  }
  return '';
}
