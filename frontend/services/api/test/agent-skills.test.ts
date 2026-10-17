import { mkdtemp, cp, appendFile, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentSkillSchema } from '@citeladder/contracts/agent';
import { agentSettings } from '../src/agent/config.ts';
import { loadSkillCatalog } from '../src/agent/skills.ts';
import { parseContentFormats } from '../src/config/skill-inputs.ts';

describe('packaged Agent model inputs', () => {
  it('keeps prose hash prefixes inside a format body', () => {
    const { formats } = parseContentFormats(
      '# Formats\n## page — Page\nBody\n##id is prose, not a heading.\n',
    );
    expect(formats.get('page')?.body).toContain('##id is prose');
  });
  const root = agentSettings({}).skillsDirectory;
  it('loads the same catalog from a standalone API package using its default asset path', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'agent-package-'));
    try {
      await cp(root, join(temporary, 'assets/agent-skills'), { recursive: true });
      await mkdir(join(temporary, 'src/config'), { recursive: true });
      const resolver = join(temporary, 'src/config/skill-inputs.ts');
      await cp(new URL('../src/config/skill-inputs.ts', import.meta.url), resolver);
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          "import { pathToFileURL } from 'node:url'; const { resolveSkillsDirectory } = await import(pathToFileURL(process.argv[1]).href); process.stdout.write(resolveSkillsDirectory(''));",
          resolver,
        ],
        { cwd: temporary },
      );
      const packaged = await loadSkillCatalog(stdout);
      expect(packaged).toEqual(await loadSkillCatalog(root));
      await rm(join(temporary, 'assets'), { recursive: true });
      await expect(loadSkillCatalog(stdout)).rejects.toThrow();
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
  it('keeps example headings inside fenced methodology text and continues at the next format', () => {
    const { formats } = parseContentFormats(
      '# Formats\n## page — Page\nBody\n~~~markdown\n## example — Example\nLiteral example.\n~~~\n## briefing — Briefing\nBrief.',
    );
    expect([...formats.keys()]).toEqual(['page', 'briefing']);
    expect(formats.get('page')?.body).toContain('## example — Example');
  });
  it.each(['  ## briefing — Briefing', '## briefing malformed'])(
    'rejects malformed format headings %s instead of hiding them in a prior format',
    (heading) => {
      expect(() =>
        parseContentFormats('# Formats\n\n## page — Page\nBody\n' + heading + '\nBody'),
      ).toThrow('Invalid content format');
    },
  );
  it('loads packaged metadata with every vocabulary expanded', async () => {
    const catalog = await loadSkillCatalog(root);
    const skills = [...catalog.skills.values()];
    for (const skill of skills) agentSkillSchema.parse({ ...skill, output_kind: skill.outputKind });
    expect(skills.some((skill) => /\{\{[a-z_]+\}\}/u.test(skill.body))).toBe(false);
  });
  it('reads the long-form marker without making it part of the label', () => {
    const { formats } = parseContentFormats(
      '# Formats\n## guide — Guide [long-form]\nBody\n## post — Post\nBody\n',
    );
    expect([...formats.values()].map(({ label, longForm }) => [label, longForm])).toEqual([
      ['Guide', true],
      ['Post', false],
    ]);
  });
  it('fingerprints workflows and refuses one that names a missing skill, format or next step', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'agent-workflows-'));
    try {
      await cp(root, temporary, { recursive: true });
      const path = join(temporary, 'workflows.json');
      const original = JSON.parse(await readFile(path, 'utf8'));
      const first = await loadSkillCatalog(temporary);
      const write = (mutate: (file: typeof original) => void) => {
        const file = structuredClone(original);
        mutate(file);
        return writeFile(path, JSON.stringify(file));
      };
      await write((file) => (file.workflows[0].label = 'Renamed'));
      expect((await loadSkillCatalog(temporary)).version).not.toBe(first.version);
      await write((file) => (file.workflows[0].skill_id = 'missing_skill'));
      await expect(loadSkillCatalog(temporary)).rejects.toThrow('unknown skill');
      // A format only applies to a skill whose output kind has formats.
      await write((file) => {
        const planner = file.workflows.find(
          (workflow: { skill_id: string }) => workflow.skill_id === 'growth_plan',
        );
        planner.format_id = 'article';
      });
      await expect(loadSkillCatalog(temporary)).rejects.toThrow('unusable format');
      await write((file) => (file.kinds.content.next[0].workflow = 'missing_workflow'));
      await expect(loadSkillCatalog(temporary)).rejects.toThrow('unknown workflow');
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
  it('fingerprints every model input and rejects undeclared vocabulary and duplicate metadata', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'agent-catalog-'));
    try {
      await cp(root, temporary, { recursive: true });
      // The runtime image supplies this exact alias and has no checkout fallback.
      const first = await loadSkillCatalog(
        agentSettings({ AGENT_SKILLS_DIRECTORY: temporary }).skillsDirectory,
      );
      await appendFile(
        join(temporary, 'content_formats.md'),
        '\n## briefing — Briefing\nA bounded briefing.\n',
      );
      const changed = await loadSkillCatalog(temporary);
      expect(changed.formats.has('briefing')).toBe(true);
      expect(changed.version).not.toBe(first.version);
      await appendFile(join(temporary, 'operating_contract.md'), '\nNew operating constraint.\n');
      expect((await loadSkillCatalog(temporary)).version).not.toBe(first.version);
      const skillPath = join(temporary, 'skills/content_create/SKILL.md');
      await appendFile(skillPath, '\n{{unregistered_vocabulary}}\n');
      await expect(loadSkillCatalog(temporary)).rejects.toThrow('Unknown skill vocabulary');
      await writeFile(skillPath, '---\nid: content_create\nid: content_create\n---\nBody');
      await expect(loadSkillCatalog(temporary)).rejects.toThrow('Invalid skill metadata');
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
