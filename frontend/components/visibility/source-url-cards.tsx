'use client';

import type { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { BrandLogo } from '@/components/ui/brand-logo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { QueryState } from '@/components/ui/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ClampText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { textRole } from '@/components/ui/typography';
import { MissingValue } from '@/components/ui/unavailable-value';
import type { visibilitySourceUrlSchema } from '@citeladder/contracts/visibility-evidence';
import { engineLabel, productModelLabel } from '@/lib/providers/catalog';
import { count } from '@/lib/visibility/sources';

type UrlDetail = z.infer<typeof visibilitySourceUrlSchema>;

/**
 * The three tables and lists below a URL's overview.
 *
 * Split out of the detail page so that one file holds the page's shape and
 * this one holds its contents. Together they exceeded the complexity ceiling,
 * and the states were the half that made the content hard to find.
 */

/** A card whose body is a table once there is one, and a sentence before then. */
function SectionCard({
  title,
  caption,
  loading,
  errored,
  empty,
  children,
}: Readonly<{
  title: string;
  caption?: string;
  loading: boolean;
  /** A read that FAILED has no data, so its empty sentence would be a lie. */
  errored?: boolean;
  empty: string;
  children: React.ReactNode | null;
}>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {caption ? <CardDescription>{caption}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <SectionBody loading={loading} errored={errored} empty={empty}>
          {children}
        </SectionBody>
      </CardContent>
    </Card>
  );
}

/**
 * The card's body, once its states are separated from its frame.
 *
 * The error branch comes first and renders NOTHING: "no engine used this page"
 * and "we could not find out" are different answers, and a failed request can
 * only honestly give the second. The page's own alert already reports it.
 */
function SectionBody({
  loading,
  errored,
  empty,
  children,
}: Readonly<{
  loading: boolean;
  errored?: boolean;
  empty: string;
  children: React.ReactNode | null;
}>) {
  if (errored) return null;
  if (loading) return <Skeleton className="h-24" />;
  if (children) return <>{children}</>;
  return <QueryState kind="empty" inline message={empty} />;
}

export function EnginesCard({
  engines,
  loading,
  errored,
}: Readonly<{
  engines: UrlDetail['engines'] | undefined;
  loading: boolean;
  errored?: boolean;
}>) {
  return (
    <SectionCard
      title="Retrievals by AI model"
      caption="Which engines used this page as a source."
      loading={loading}
      errored={errored}
      empty="No engine used this page in this selection."
    >
      {engines?.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead numeric>Retrievals</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {engines.map((row) => (
              <TableRow key={`${row.logical_engine}:${row.transport_model ?? ''}`}>
                <TableCell>
                  <span className="grid min-w-0">
                    <ClampText lines={1}>
                      {engineLabel(row.logical_engine) || row.logical_engine}
                    </ClampText>
                    {productModelLabel(row.logical_engine, row.transport_model) ? (
                      <ClampText lines={1} className={textRole('caption', 'text-secondary')}>
                        {productModelLabel(row.logical_engine, row.transport_model)}
                      </ClampText>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell numeric>{count(row.retrievals) ?? <MissingValue />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </SectionCard>
  );
}

/**
 * The brands named in the answers that cited this page.
 *
 * The caption is load-bearing: this is co-occurrence in an answer, and the
 * page's own inspected presence is a different fact. Dropping the qualifier
 * would make the two indistinguishable on screen.
 */
export function BrandsCard({
  brands,
  loading,
  errored,
}: Readonly<{
  brands: UrlDetail['brands'] | undefined;
  loading: boolean;
  errored?: boolean;
}>) {
  return (
    <SectionCard
      title="Named in the answers"
      caption="Named in the answers that cited this URL — not necessarily present on the page itself."
      loading={loading}
      errored={errored}
      empty="No tracked brand was named in the answers citing this URL."
    >
      {brands?.length ? (
        <ul className="grid gap-2">
          {brands.map((brand) => (
            <li key={`${brand.kind}:${brand.name}`} className="flex items-center gap-2">
              <BrandLogo name={brand.name} logoUrl={brand.logo_url} websiteUrl={brand.website} />
              <span className="min-w-0 truncate">{brand.name}</span>
              <Badge
                className="ml-auto shrink-0"
                variant="classification"
                value={brand.kind === 'brand' ? 'owned' : 'competitor'}
              >
                {count(brand.responses) ?? '0'}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </SectionCard>
  );
}
