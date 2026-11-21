import { policy } from '../../config.ts';

export const analysisPolicy = policy.site_health.page_analysis;
export const limits = analysisPolicy.facts.limits;
export const regionPolicy = analysisPolicy.regions;

export const squash = (value: string) => value.replaceAll(/\s+/gu, ' ').trim();
export const words = (value: string) => squash(value).split(' ').filter(Boolean);
