import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import { optionalStringUrlCodec, type UrlCodec, type UrlHistory } from './url-state';

const flagUrlCodec: UrlCodec<boolean> = {
  parse: (raw) => raw === '1',
  serialize: (value) => (value ? '1' : null),
};

type UrlParamTypes = {
  analysis: string | null;
  connected: string | null;
  discovery: string | null;
  error: string | null;
  execution: string | null;
  link: string | null;
  links_page: string | null;
  links_q: string | null;
  links_status: string | null;
  new: boolean;
  project: string | null;
  rerun: boolean;
  return_to: string | null;
  setup: string | null;
  sort: string | null;
  step: string | null;
  token: string | null;
  workspace: string | null;
};

export type UrlParamName = keyof UrlParamTypes;
export type UrlParamValues = { readonly [N in UrlParamName]?: UrlParamTypes[N] };

const URL_PARAMS: { readonly [N in UrlParamName]: UrlCodec<UrlParamTypes[N]> } = {
  analysis: optionalStringUrlCodec,
  connected: optionalStringUrlCodec,
  discovery: optionalStringUrlCodec,
  error: optionalStringUrlCodec,
  execution: optionalStringUrlCodec,
  link: optionalStringUrlCodec,
  links_page: optionalStringUrlCodec,
  links_q: optionalStringUrlCodec,
  links_status: optionalStringUrlCodec,
  new: flagUrlCodec,
  project: optionalStringUrlCodec,
  rerun: flagUrlCodec,
  return_to: optionalStringUrlCodec,
  setup: optionalStringUrlCodec,
  sort: optionalStringUrlCodec,
  step: optionalStringUrlCodec,
  token: optionalStringUrlCodec,
  workspace: optionalStringUrlCodec,
};

export function urlParamHref<N extends UrlParamName>(name: N, value: UrlParamTypes[N]): string {
  const encoded = URL_PARAMS[name].serialize(value);
  return encoded === null ? '' : `?${new URLSearchParams({ [name]: encoded }).toString()}`;
}

export function readUrlParam<N extends UrlParamName>(
  params: URLSearchParams,
  name: N,
): UrlParamTypes[N] {
  return URL_PARAMS[name].parse(params.get(name));
}

function isUrlParamName(name: string): name is UrlParamName {
  return Object.hasOwn(URL_PARAMS, name);
}

function writeParam<N extends UrlParamName>(
  params: URLSearchParams,
  name: N,
  values: UrlParamValues,
): void {
  const value = values[name];
  if (value === undefined) return;
  const encoded = URL_PARAMS[name].serialize(value);
  if (encoded === null) params.delete(name);
  else params.set(name, encoded);
}

export function withUrlParams(
  params: URLSearchParams | null,
  values: UrlParamValues,
): URLSearchParams {
  const next = new URLSearchParams(params ?? undefined);
  for (const name of Object.keys(values)) {
    if (isUrlParamName(name)) writeParam(next, name, values);
  }
  return next;
}

export function useUrlSearch(): URLSearchParams {
  return useSearchParams()[0];
}

export function useUrlParam<N extends UrlParamName>(name: N): UrlParamTypes[N] {
  return readUrlParam(useUrlSearch(), name);
}

export function useSetUrlParams(): (values: UrlParamValues, history?: UrlHistory) => void {
  const setParams = useSearchParams()[1];
  return useCallback(
    (values, history = 'push') =>
      setParams((current) => withUrlParams(current, values), { replace: history === 'replace' }),
    [setParams],
  );
}
