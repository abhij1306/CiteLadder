/**
 * Shared display-format vocabulary — ONE owner for the
 * date / count / URL / snapshot-granularity formatters the Traffic,
 * AI Referrals, and Settings→Integrations surfaces all render with.
 *
 * The domain modules (`lib/traffic/traffic`, `lib/ai-traffic/options`,
 * `lib/ai-traffic/series`) re-export these under their local names so
 * domain import sites stay local; new code should import from here.
 *
 * Everything is pure and framework-free. Calendar bucket dates are fixed to
 * UTC; timestamp displays receive an explicit resolved timezone. Unparseable
 * input passes through untouched — never a fabricated value.
 */
import type { z } from 'zod';

import type { snapshotGranularitySchema } from '@citeladder/contracts/analytics';

type BucketGranularity = z.infer<typeof snapshotGranularitySchema>;

export const ABSENCE_STATES = [
  'not_measured',
  'not_connected',
  'not_set',
  'not_run',
  'none',
  'not_applicable',
  'unavailable',
  'too_few',
] as const;

export type DataAvailabilityState = (typeof ABSENCE_STATES)[number];

const availabilityLabels: Record<DataAvailabilityState, string> = {
  not_measured: 'Not measured',
  not_connected: 'Not connected',
  not_set: 'Not set',
  not_run: 'Not run yet',
  none: 'None',
  not_applicable: 'Not applicable',
  unavailable: 'Unavailable',
  too_few: 'Too few',
};

export function availabilityLabel(state: DataAvailabilityState): string {
  return availabilityLabels[state];
}

export type Absent = Readonly<{ absent: DataAvailabilityState }>;

export type Formatted = string | Absent;

export function absent(state: DataAvailabilityState = 'not_measured'): Absent {
  return { absent: state };
}

export function isAbsent(value: unknown): value is Absent {
  return typeof value === 'object' && value !== null && 'absent' in value;
}

export function formattedText(value: Formatted): string {
  return isAbsent(value) ? availabilityLabel(value.absent) : value;
}

export const ABSENCE_MARK = '—';

export function formatPercent(fraction: number): string;
export function formatPercent(fraction: number | null): Formatted;
export function formatPercent(fraction: number | null): Formatted {
  if (fraction === null) return absent();
  return percentText(fraction);
}

export function percentText(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

export function formatAmount(amount: number, currency: string | null): string {
  if (currency && /^[A-Z]{3}$/u.test(currency)) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
    } catch {}
  }
  const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount);
  return currency ? `${number} ${currency}` : number;
}

export function formatMean(value: number): string {
  return value.toFixed(1);
}

export const GRANULARITY_OPTIONS: readonly { value: BucketGranularity; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
] as const;

export function formatShortDate(isoDay: string): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDay;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function formatWindowDate(isoDay: string): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDay;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatMonth(isoMonth: string): string {
  const date = new Date(`${isoMonth.slice(0, 7)}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoMonth;
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(variant: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${variant}\u0000${options.timeZone}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', options);
    dateFormats.set(key, format);
  }
  return format;
}

export function formatDisplayTimestamp(timestamp: string, timeZone: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  try {
    return dateFormat('instant', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }).format(date);
  } catch {
    return timeZone === 'UTC' ? timestamp : formatDisplayTimestamp(timestamp, 'UTC');
  }
}

export function formatStripTimestamp(timestamp: string, timeZone: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  try {
    const parts = dateFormat('strip', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone,
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value ?? '';
    return `${part('day')} ${part('month')} ${part('hour')}:${part('minute')}`;
  } catch {
    return timeZone === 'UTC' ? timestamp : formatStripTimestamp(timestamp, 'UTC');
  }
}

export function formatStripDay(isoDay: string): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDay;
  const parts = dateFormat('strip-day', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('day')} ${part('month')}`;
}

export function formatDisplayDate(timestamp: string, timeZone: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  try {
    return dateFormat('date', { dateStyle: 'medium', timeZone }).format(date);
  } catch {
    return timeZone === 'UTC' ? timestamp : formatDisplayDate(timestamp, 'UTC');
  }
}

export function formatDisplayTime(timestamp: string, timeZone: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  try {
    return dateFormat('time', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }).format(date);
  } catch {
    return timeZone === 'UTC' ? timestamp : formatDisplayTime(timestamp, 'UTC');
  }
}

export function formatDisplayShortDate(timestamp: string, timeZone: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  try {
    return dateFormat('short-date', { month: 'short', day: 'numeric', timeZone }).format(date);
  } catch {
    return timeZone === 'UTC' ? timestamp : formatDisplayShortDate(timestamp, 'UTC');
  }
}

export function formatScore(score: number | null): Formatted {
  return score === null || Number.isNaN(score) ? absent() : `${Math.round(score)}`;
}

const numberFormat = new Intl.NumberFormat('en-US');

export function formatCount(value: number): string {
  return numberFormat.format(value);
}

export function pluralCount(count: number, noun: string): string {
  return `${formatCount(count)} ${noun}${count === 1 ? '' : 's'}`;
}

export function endSentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

const MAX_URL_DECODE_PASSES = 3;

export function readableUrl(value: string): string {
  let current = value;
  for (let pass = 0; pass < MAX_URL_DECODE_PASSES; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return current;
    }
    if (next === current) return current;
    current = next;
  }
  return current;
}

export function shortUrlTitle(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return readableUrl(value);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return readableUrl(value);
  const host = url.hostname.replace(/^www\./u, '');
  const segments = url.pathname.split('/').filter(Boolean);
  const last = segments.at(-1);
  if (last === undefined) return host;
  return `${host}${segments.length > 1 ? '/…' : ''}/${readableUrl(last)}`;
}

function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

export function sharedOrigin(values: readonly string[]): string | null {
  const [first, ...rest] = values.map(originOf);
  if (first === undefined || first === null) return null;
  return rest.every((origin) => origin === first) ? first : null;
}

/** ISO 3166-1 alpha-3 to alpha-2, each pair run together: Search Console reports alpha-3. */
const ALPHA3_TO_ALPHA2 = new Map(
  `AFGAF ALAAX ALBAL DZADZ ASMAS ANDAD AGOAO AIAAI ATAAQ ATGAG ARGAR ARMAM ABWAW AUSAU AUTAT
  AZEAZ BHSBS BHRBH BGDBD BRBBB BLRBY BELBE BLZBZ BENBJ BMUBM BTNBT BOLBO BESBQ BIHBA BWABW
  BVTBV BRABR IOTIO BRNBN BGRBG BFABF BDIBI CPVCV KHMKH CMRCM CANCA CYMKY CAFCF TCDTD CHLCL
  CHNCN CXRCX CCKCC COLCO COMKM COGCG CODCD COKCK CRICR CIVCI HRVHR CUBCU CUWCW CYPCY CZECZ
  DNKDK DJIDJ DMADM DOMDO ECUEC EGYEG SLVSV GNQGQ ERIER ESTEE SWZSZ ETHET FLKFK FROFO FJIFJ
  FINFI FRAFR GUFGF PYFPF ATFTF GABGA GMBGM GEOGE DEUDE GHAGH GIBGI GRCGR GRLGL GRDGD GLPGP
  GUMGU GTMGT GGYGG GINGN GNBGW GUYGY HTIHT HMDHM VATVA HNDHN HKGHK HUNHU ISLIS INDIN IDNID
  IRNIR IRQIQ IRLIE IMNIM ISRIL ITAIT JAMJM JPNJP JEYJE JORJO KAZKZ KENKE KIRKI PRKKP KORKR
  KWTKW KGZKG LAOLA LVALV LBNLB LSOLS LBRLR LBYLY LIELI LTULT LUXLU MACMO MDGMG MWIMW MYSMY
  MDVMV MLIML MLTMT MHLMH MTQMQ MRTMR MUSMU MYTYT MEXMX FSMFM MDAMD MCOMC MNGMN MNEME MSRMS
  MARMA MOZMZ MMRMM NAMNA NRUNR NPLNP NLDNL NCLNC NZLNZ NICNI NERNE NGANG NIUNU NFKNF MKDMK
  MNPMP NORNO OMNOM PAKPK PLWPW PSEPS PANPA PNGPG PRYPY PERPE PHLPH PCNPN POLPL PRTPT PRIPR
  QATQA REURE ROURO RUSRU RWARW BLMBL SHNSH KNAKN LCALC MAFMF SPMPM VCTVC WSMWS SMRSM STPST
  SAUSA SENSN SRBRS SYCSC SLESL SGPSG SXMSX SVKSK SVNSI SLBSB SOMSO ZAFZA SGSGS SSDSS ESPES
  LKALK SDNSD SURSR SJMSJ SWESE CHECH SYRSY TWNTW TJKTJ TZATZ THATH TLSTL TGOTG TKLTK TONTO
  TTOTT TUNTN TURTR TKMTM TCATC TUVTV UGAUG UKRUA AREAE GBRGB USAUS UMIUM URYUY UZBUZ VUTVU
  VENVE VNMVN VGBVG VIRVI WLFWF ESHEH YEMYE ZMBZM ZWEZW XKKXK`
    .split(/\s+/u)
    .map((pair) => [pair.slice(0, 3), pair.slice(3)] as const),
);

let regionNames: Intl.DisplayNames | undefined;

export function formatCountry(code: string): string {
  const upper = code.trim().toUpperCase();
  const alpha2 = ALPHA3_TO_ALPHA2.get(upper) ?? (/^[A-Z]{2}$/u.test(upper) ? upper : null);
  if (!alpha2) return upper;
  regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
  return regionNames.of(alpha2) ?? upper;
}

export function ownOrigin(url: string, website: string | null | undefined): string | null {
  try {
    return isOwnHost(new URL(url).host, website) ? originOf(url) : null;
  } catch {
    return null;
  }
}

export function isOwnHost(host: string, website: string | null | undefined): boolean {
  const bare = (value: string) => value.toLowerCase().replace(/^www\./u, '');
  try {
    return Boolean(website) && bare(host) === bare(new URL(website ?? '').host);
  } catch {
    return false;
  }
}

export function urlCellText(value: string, origin: string | null): string {
  const readable = readableUrl(value);
  if (origin === null || originOf(value) !== origin || !value.startsWith(origin)) return readable;
  const path = readableUrl(value.slice(origin.length));
  return path === '' ? '/' : path;
}
