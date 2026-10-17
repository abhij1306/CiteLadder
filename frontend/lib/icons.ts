import {
  Activity,
  AlertCircle,
  BookOpen,
  Bot,
  Check,
  FileBarChart,
  FileText,
  Gauge,
  Globe,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  LoaderCircle,
  MapPin,
  MessageSquareText,
  OctagonAlert,
  Package,
  Radar,
  SquarePen,
  Settings,
  ShieldCheck,
  Sparkles,
  Telescope,
  TrendingUp,
  TriangleAlert,
  Wrench,
} from 'lucide-react';

/**
 * Canonical icon map — the single source of truth for which lucide glyph
 * represents each product concept. Nav and shared UI import icons by concept
 * (`ICONS.warning`) instead of picking glyph names ad hoc.
 *
 * Conventions:
 * - spinner = `LoaderCircle` (only)
 * - warning = `TriangleAlert` (only)
 * - danger = `AlertCircle` (only)
 * - success = `Check` (only)
 *
 * Nav notes: issues uses `OctagonAlert`, NOT `CircleAlert` (an alias of
 * `AlertCircle` — the same glyph as danger). `Settings` is for the user menu
 * only; the Setup nav concept uses `Wrench`.
 *
 * lucide-react ships alias pairs with identical glyphs (legacy names exist
 * for the spinner and warning glyphs); this module canonicalizes one name
 * per pair so call sites stay consistent and grep-able.
 *
 * Visual contract (applies to every lucide glyph, not just the ones mapped
 * here — see the icon stroke ladder in `apps/app/src/globals.css`):
 * - Size is the only thing a call site picks. `size-3`/`size-3.5` for dense
 *   tables, toolbars, and inline chips; `size-4` for chrome; `size-5` for
 *   empty states; larger only for decorative marks.
 * - Weight follows from that size. Do not pass `strokeWidth` — lucide scales
 *   it by the icon's size, so a per-call-site number makes weight drift, and
 *   the stylesheet overrides the prop anyway. A deliberate outlier uses
 *   inline `style={{ strokeWidth: n }}`.
 * - Colour stays `currentColor`, so `text-muted` and `text-accent-text` paint
 *   the glyph. Never hard-code a stroke colour.
 */
export const ICONS = {
  // The four layers: these are the sidebar's primary destinations.
  site: Globe,
  demand: Radar,
  agent: Bot,
  reports: FileBarChart,
  overview: LayoutDashboard,
  // Nav concepts.
  visibility: Gauge,
  // The answer engines themselves (the surfaces a run asks).
  analytics: Bot,
  searchIntelligence: Telescope,
  aiTraffic: Activity,
  performance: TrendingUp,
  prompts: MessageSquareText,
  products: Package,
  runs: ListChecks,
  content: FileText,
  siteHealth: ShieldCheck,
  issues: OctagonAlert,
  opportunities: Lightbulb,
  // Agent workspace.
  newChat: SquarePen,
  skills: Sparkles,
  context: BookOpen,
  setup: Wrench,
  settings: Settings,
  // Shared UI concepts.
  market: MapPin,
  spinner: LoaderCircle,
  warning: TriangleAlert,
  danger: AlertCircle,
  success: Check,
} as const;
