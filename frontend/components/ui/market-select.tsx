'use client';

import {
  AE,
  AR,
  AT,
  AU,
  BE,
  BR,
  CA,
  CH,
  CL,
  CO,
  DE,
  DK,
  ES,
  FI,
  FR,
  GB,
  IE,
  IL,
  IN,
  IT,
  JP,
  KR,
  MX,
  NL,
  NO,
  NZ,
  PL,
  PT,
  SE,
  SG,
  US,
  ZA,
} from 'country-flag-icons/react/3x2';

import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';
import type { MarketOption } from '@citeladder/contracts/markets';

const COUNTRY_FLAGS = {
  AE,
  AR,
  AT,
  AU,
  BE,
  BR,
  CA,
  CH,
  CL,
  CO,
  DE,
  DK,
  ES,
  FI,
  FR,
  GB,
  IE,
  IL,
  IN,
  IT,
  JP,
  KR,
  MX,
  NL,
  NO,
  NZ,
  PL,
  PT,
  SE,
  SG,
  US,
  ZA,
} as const;

/** Country/language adapter for the shared searchable combobox. */
export function MarketSelect({
  options,
  showCountryFlags = false,
  ...props
}: Readonly<{
  id?: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  options: readonly MarketOption[];
  placeholder?: string;
  showCountryFlags?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
}>) {
  const selectOptions: readonly SearchableSelectOption[] = options;
  return (
    <SearchableSelect
      {...props}
      options={selectOptions}
      renderLeading={showCountryFlags ? (option) => <CountryFlag code={option.value} /> : undefined}
      renderOptionEnd={(option) =>
        option.value.trim().toLowerCase() === option.label.trim().toLowerCase() ? null : (
          <span className="text-muted max-w-24 truncate tabular-nums">{option.value}</span>
        )
      }
    />
  );
}

function CountryFlag({ code }: Readonly<{ code: string }>) {
  if (code === 'GLOBAL') {
    return (
      <span
        data-country-flag="GLOBAL"
        className="flex size-5 shrink-0 items-center justify-center text-base leading-none"
        aria-hidden
      >
        🌐
      </span>
    );
  }
  const Flag = COUNTRY_FLAGS[code as keyof typeof COUNTRY_FLAGS];
  return Flag ? (
    <Flag
      data-country-flag={code}
      className="h-3.5 w-5 shrink-0 overflow-hidden rounded-xs"
      aria-hidden
    />
  ) : null;
}
