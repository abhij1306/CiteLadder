import { describe, expect, it } from 'vite-plus/test';
import { routePath } from './route-path';

describe('routePath', () => {
  it('drops every trailing slash and lower-cases the path', () => {
    expect(routePath('/Site/Issues///')).toBe('/site/issues');
    expect(routePath('/ai-traffic')).toBe('/ai-traffic');
  });

  it('keeps inner slashes and reduces a slash-only path to empty', () => {
    expect(routePath('//a//b/')).toBe('//a//b');
    expect(routePath('///')).toBe('');
  });
});
