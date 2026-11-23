import { readFile } from 'node:fs/promises';
import { mcpPolicy } from './config.ts';

export const appToolMetadata = { ui: { resourceUri: mcpPolicy.ui_resource_uri } };
export const appResource = {
  uri: mcpPolicy.ui_resource_uri,
  name: 'citeladder-analytics',
  title: 'CiteLadder analytics',
  mimeType: mcpPolicy.ui_mime_type,
};
export async function readAppResource() {
  let text: string;
  try {
    text = await readFile(
      new URL('../../assets/mcp-app/v1/analytics.html', import.meta.url),
      'utf8',
    );
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    text = await readFile(
      new URL('../../../../packages/mcp-app/dist/analytics.html', import.meta.url),
      'utf8',
    );
  }
  return {
    contents: [
      {
        ...appResource,
        text,
        _meta: {
          ui: {
            prefersBorder: true,
            csp: { connectDomains: [], resourceDomains: [], frameDomains: [] },
          },
        },
      },
    ],
  };
}
