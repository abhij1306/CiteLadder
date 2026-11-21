import { policy } from '../../config.ts';
import { compareText } from '../../text-order.ts';
import { crawlSiteChecks, readinessReason, scoreAnalysis } from './scoring.ts';
import type { RuleEvaluation } from './rules.ts';

type Measurement = ReturnType<typeof scoreAnalysis>;
export type MeasuredPage = { id: string; page_kind: string; evaluations: RuleEvaluation[] };
function state(scored: number, expected: number, unresolved: boolean) {
  if (!scored || !expected) return 'not_measured';
  return scored < expected || unresolved ? 'limited_evidence' : 'measured';
}

class RoleSum {
  pages = 0;
  sum = 0;
  scored = 0;
  unresolved = false;
  add(score: number | null, measured: boolean) {
    this.pages++;
    if (score !== null) {
      this.sum += score;
      this.scored++;
    }
    if (!measured) this.unresolved = true;
  }
  result() {
    return {
      score: this.scored ? this.sum / this.scored : null,
      coverage: this.pages ? this.scored / this.pages : null,
      state: state(this.scored, this.pages, this.unresolved),
    };
  }
}

const EMPTY_DIMENSIONS = () => scoreAnalysis([], 'other').readiness_dimensions;

class DimensionSum {
  applicable = 0;
  sum = 0;
  scored = 0;
  unresolved = 0;
  checkpoints = new Set<string>();
  add(pillar: Measurement['readiness_dimensions'][number]) {
    if (pillar.dimension_applicability !== 'applicable') return;
    this.applicable++;
    if (pillar.score !== null) {
      this.sum += pillar.score;
      this.scored++;
    }
    this.unresolved += pillar.unresolved_count;
    for (const id of pillar.determinate_checkpoint_ids) this.checkpoints.add(id);
  }
  result(fallback: Measurement['readiness_dimensions'][number]) {
    if (!this.applicable) return fallback;
    const measurement = state(this.scored, this.applicable, this.unresolved > 0);
    return {
      ...fallback,
      dimension_applicability: 'applicable',
      dimension_measurement_state: measurement,
      score: this.scored ? this.sum / this.scored : null,
      coverage: this.scored / this.applicable,
      earned_points: this.sum / 100,
      determinate_points: this.scored,
      expected_points: this.applicable,
      determinate_checkpoint_ids: [...this.checkpoints].sort(compareText),
      reason: measurement === 'measured' ? '' : 'unresolved_checks',
      unresolved_count: this.unresolved,
    };
  }
}

class PageSetFold {
  private readonly web = new RoleSum();
  private readonly aeo = new RoleSum();
  private readonly dimensions = EMPTY_DIMENSIONS().map(() => new DimensionSum());
  private pages = 0;
  add(page: Measurement) {
    this.pages++;
    this.web.add(page.web_fundamentals_score, page.web_fundamentals_state === 'measured');
    this.aeo.add(page.aeo_readiness_score, page.aeo_measurement_state === 'measured');
    page.readiness_dimensions.forEach((pillar, index) => this.dimensions[index]?.add(pillar));
  }
  result() {
    const web = this.web.result();
    const aeo = this.aeo.result();
    const empty = EMPTY_DIMENSIONS();
    return {
      web_fundamentals_score: web.score,
      web_fundamentals_coverage: web.coverage,
      web_fundamentals_state: web.state,
      aeo_readiness_score: aeo.score,
      aeo_measurement_coverage: aeo.coverage,
      aeo_measurement_state: aeo.state,
      readiness_dimensions: this.dimensions.map((sum, index) => sum.result(empty[index]!)),
      analyzed_url_count: this.pages,
      scoring_version: policy.site_health.reads.scoring_version,
    };
  }
}

export class MeasurementFold {
  private readonly all = new PageSetFold();
  private readonly kinds = new Map<string, PageSetFold>();
  private readonly site: RuleEvaluation[];
  constructor(site: RuleEvaluation[]) {
    this.site = site;
  }
  add(page: Omit<MeasuredPage, 'id'>) {
    const measured = scoreAnalysis(page.evaluations, page.page_kind, this.site);
    this.all.add(measured);
    const kind = this.kinds.get(page.page_kind) ?? new PageSetFold();
    kind.add(measured);
    this.kinds.set(page.page_kind, kind);
  }
  aggregate() {
    return this.all.result();
  }
  byPageKind() {
    return Object.fromEntries(
      [...this.kinds.keys()].sort(compareText).map((kind) => {
        const {
          readiness_dimensions: dimensions,
          analyzed_url_count: analyzed,
          scoring_version: _version,
          ...scores
        } = this.kinds.get(kind)!.result();
        const applicable = dimensions.some(
          (dimension) => dimension.dimension_applicability === 'applicable',
        );
        const reason = readinessReason(
          scores.aeo_readiness_score,
          scores.aeo_measurement_state,
          applicable,
          kind,
        );
        return [kind, { ...scores, analyzed_count: analyzed, aeo_measurement_reason: reason }];
      }),
    );
  }
}

const siteChecksOf = (rows: MeasuredPage[]) =>
  crawlSiteChecks(rows.flatMap((row) => row.evaluations));

function foldOf(rows: MeasuredPage[], site: RuleEvaluation[]) {
  const fold = new MeasurementFold(site);
  for (const row of rows) fold.add(row);
  return fold;
}

export function aggregateMeasurements(rows: MeasuredPage[], site = siteChecksOf(rows)) {
  return foldOf(rows, site).aggregate();
}

export function aggregateByPageKind(rows: MeasuredPage[]) {
  return foldOf(rows, siteChecksOf(rows)).byPageKind();
}
