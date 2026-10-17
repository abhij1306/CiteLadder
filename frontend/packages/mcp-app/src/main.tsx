import { createRoot } from 'react-dom/client';
import { App } from '@modelcontextprotocol/ext-apps';
import { Analytics } from './analytics';
import { createController } from './controller';
import { appPolicy } from './config';
import './analytics.css';

const app = new App(
  { name: 'CiteLadder analytics', version: appPolicy.version },
  {},
  { autoResize: true },
);
const controller = createController({
  async call(name, args) {
    const result = await app.callServerTool(
      { name, arguments: args },
      { timeout: appPolicy.requestTimeoutMs },
    );
    if (result.isError || !result.structuredContent) throw new Error('Evidence unavailable');
    return result.structuredContent;
  },
  async context(selection, evidence) {
    await app.updateModelContext({
      structuredContent: {
        selection,
        evidence_state: evidence?.state ?? null,
        artifact_refs: Array.isArray(evidence?.artifact_refs) ? evidence.artifact_refs : [],
        limitations: Array.isArray(evidence?.limitations) ? evidence.limitations : [],
      },
      content: [
        {
          type: 'text',
          text: selection
            ? 'CiteLadder selected persisted scope. Use its concrete IDs for follow-up reads; recommendations are not measured impact.'
            : 'No CiteLadder evidence selected.',
        },
      ],
    });
  },
});
const hostContext = (context: Record<string, unknown>) => {
  document.documentElement.dataset.theme = context.theme === 'dark' ? 'dark' : 'light';
};
app.ontoolresult = (result) => {
  if (result.isError) controller.failHostRead();
  else controller.receive(result.structuredContent);
};
app.ontoolinput = (input) =>
  controller.begin(input.arguments, app.getHostContext()?.toolInfo?.tool.name);
app.onhostcontextchanged = (context) => hostContext(context);
app.ontoolcancelled = () => controller.failHostRead();
createRoot(document.getElementById('root')!).render(<Analytics controller={controller} />);
try {
  await app.connect(undefined, { timeout: appPolicy.requestTimeoutMs });
  hostContext(app.getHostContext() ?? {});
  await controller.loadProjects();
} catch {
  controller.disconnect();
}
