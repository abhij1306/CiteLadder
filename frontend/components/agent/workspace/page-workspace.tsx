import { useMemo, useRef, useState, type ReactNode } from 'react';

import { isDeclarable, MarkImplementedButton } from '@/components/agent/action-declaration';
import { useChatThread } from '@/components/agent/chat-thread';
import { contentGapMembers } from '@/components/agent/content-gap-evidence';
import { WorkbenchPage } from '@/components/templates/workbench-page';
import { StatusMark } from '@/components/ui/status-mark';
import { Button } from '@/components/ui/button';
import {
  EditorPane,
  EditorRail,
  EditorStack,
  EditorWorkspace,
} from '@/components/ui/editor-workspace';
import { Icon } from '@/components/ui/icon';
import { Inline } from '@/components/ui/layout';
import { TabPanel, TabRow, TabsRoot } from '@/components/ui/tabs';
import { textRole } from '@/components/ui/typography';
import { UnsavedChangesGuard } from '@/components/ui/unsaved-changes-guard';
import {
  suggestionHighlights,
  withQuotedReference,
  type SuggestionHighlight,
} from '@/lib/agent/page-workspace';
import { Sparkles, Undo2 } from '@/lib/icons';
import { suggestionCategoryLabel } from '@/lib/agent/vocabulary';
import type { ActionDetail } from '@/lib/api/actions';
import type { AgentChatDetail, AgentOutput, AgentRevision, AgentSuggestion } from '@/lib/api/agent';
import { shortUrlTitle } from '@/lib/format';
import { useWorkspaceCapability } from '@/lib/project/project-context';

import { ExportMenu } from './export-menu';
import { OutlinePanel } from './outline-panel';
import { PageEditor, type PageEditorHandle } from './page-editor';
import { SeoPanel } from './seo-panel';
import { SuggestionsPanel, type ContextReference } from './suggestions-panel';
import {
  useChatAction,
  usePageDraft,
  usePageSuggestions,
  usePageText,
  useWorkspaceTabs,
  type PageDraft,
  type RailTab,
  type StackTab,
} from './use-page-workspace';
import { WorkspaceChat } from './workspace-chat';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

import './page-workspace.css';

const ASK_REQUEST = 'Suggest how to improve this passage.';

function highlightLabel(suggestion: AgentSuggestion): string {
  const category = suggestionCategoryLabel(suggestion.category);
  return suggestion.readiness === 'needs_input'
    ? `${category} suggestion: needs a fact from you`
    : `${category} suggestion`;
}

function WorkspaceDeclaration({
  workspaceId,
  action,
  revision,
  disabled,
}: Readonly<{
  workspaceId: string;
  action: ActionDetail | null;
  revision: AgentRevision;
  disabled: boolean;
}>) {
  const mayWrite = useWorkspaceCapability('write');
  if (!action) return null;
  if (action.declaration) return <StatusMark tone="positive">Marked implemented</StatusMark>;
  if (!isDeclarable(action) || !mayWrite) return null;
  return (
    <MarkImplementedButton
      workspaceId={workspaceId}
      action={action}
      revision={{ id: revision.id, number: revision.number }}
      disabled={disabled}
    />
  );
}

function lockedReason(canEdit: boolean, runActive: boolean, editing: boolean): string | null {
  if (!canEdit) return 'Your role can read this page but not change it.';
  if (runActive) return 'The agent is working on the page. Changes open again when it finishes.';
  return editing ? 'Save or discard your edits to the page first.' : null;
}

function workspaceHeader(detail: AgentChatDetail, output: AgentOutput) {
  const label = output.target_label ?? detail.chat.target_label ?? output.latest_revision.title;
  const actionId = detail.chat.action_id;
  return {
    title: shortUrlTitle(label),
    trail: [
      { label: 'Actions', href: '/actions' },
      ...(actionId ? [{ label: 'Action', href: `/actions/${actionId}` }] : []),
    ],
  };
}

function SuggestionsTab({
  suggestions,
  ...props
}: Readonly<
  { suggestions: ReturnType<typeof usePageSuggestions> } & Omit<
    Parameters<typeof SuggestionsPanel>[0],
    'page'
  >
>) {
  const { query, page } = suggestions;
  if (page) return <SuggestionsPanel page={page} {...props} />;
  if (!query.isError)
    return <StateBlock kind="loading" label="Loading suggestions…" shape={{ kind: 'list' }} />;
  return (
    <StateBlock
      kind="error"
      {...readErrorProps(query)}
      title="Couldn't load the suggestions"
      fallback="The suggestions could not be loaded."
    />
  );
}

export function PageWorkspace({
  detail,
  output,
  workspaceId,
}: Readonly<{ detail: AgentChatDetail; output: AgentOutput; workspaceId: string }>) {
  const chatId = detail.chat.id;
  const revision = output.latest_revision;
  const thread = useChatThread(workspaceId, detail);
  const canEdit = useWorkspaceCapability('run');
  const tabs = useWorkspaceTabs();
  const editor = useRef<PageEditorHandle>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selection, setSelection] = useState('');
  const [focusRequest, setFocusRequest] = useState(0);
  const draft = usePageDraft(workspaceId, output, chatId);
  const suggestions = usePageSuggestions(workspaceId, detail, output);
  const { page } = suggestions;
  const action = useChatAction(workspaceId, detail.chat.action_id);
  const { shown, text, editing, status } = usePageText(detail, revision, draft);
  const highlights = useMemo<readonly SuggestionHighlight[]>(
    () => (page && shown === revision.body ? suggestionHighlights(page.items, highlightLabel) : []),
    [page, shown, revision.body],
  );

  const addToContext = (reference: ContextReference) => {
    thread.turn.setDraft((current) => withQuotedReference(current, reference));
    setFocusRequest((count) => count + 1);
    tabs.showChat();
  };
  const openCard = (id: string) => {
    setSelectedId(id);
    tabs.showSuggestions();
  };

  const pagePane = (
    <EditorPane
      label="Page"
      head={
        <PageHead
          status={status}
          draft={draft}
          canAsk={thread.access.canSend && selection.trim().length > 0}
          onAsk={() => addToContext({ quote: selection, request: ASK_REQUEST })}
        />
      }
    >
      <PageEditor
        ref={editor}
        label="Page content (Markdown)"
        text={shown}
        editing={editing}
        readOnly={thread.runActive || !canEdit}
        highlights={highlights}
        onChange={draft.edit}
        onSelection={setSelection}
        onHighlight={openCard}
      />
    </EditorPane>
  );
  const panels: Record<RailTab, ReactNode> = {
    suggestions: (
      <SuggestionsTab
        suggestions={suggestions}
        workspaceId={workspaceId}
        target={{ chatId, outputId: output.id, baseRevisionId: revision.id }}
        body={revision.body}
        locked={lockedReason(canEdit, thread.runActive, editing)}
        gaps={action ? contentGapMembers(action) : []}
        selectedId={selectedId}
        onShow={(id) => tabs.inPage(() => editor.current?.revealHighlight(id))}
        onAddToContext={addToContext}
      />
    ),
    outline: (
      <OutlinePanel
        body={text}
        onJump={(from) => tabs.inPage(() => editor.current?.jumpTo(from))}
      />
    ),
    seo: (
      <SeoPanel
        fields={revision.fields}
        fetch={detail.page_fetch?.status === 'done' ? detail.page_fetch : null}
      />
    ),
  };
  const chat = <WorkspaceChat thread={thread} detail={detail} focusRequest={focusRequest} />;
  const open = page?.counts.open;
  const header = workspaceHeader(detail, output);

  return (
    <WorkbenchPage
      title={header.title}
      trail={header.trail}
      actions={
        <>
          <WorkspaceDeclaration
            workspaceId={workspaceId}
            action={action}
            revision={revision}
            disabled={thread.runActive || editing}
          />
          <ExportMenu title={revision.fields?.title || revision.title} body={text} />
        </>
      }
    >
      <UnsavedChangesGuard when={editing} />
      {tabs.narrow ? (
        <NarrowWorkspace
          tab={tabs.stackTab}
          onTab={tabs.setStackTab}
          open={open}
          page={pagePane}
          panels={panels}
          chat={chat}
        />
      ) : (
        <EditorWorkspace
          page={pagePane}
          rail={
            <TabsRoot
              value={tabs.railTab}
              onValueChange={tabs.setRailTab}
              className="flex min-h-0 min-w-0"
            >
              <EditorRail
                head={<TabRow ariaLabel="Page tools" items={railItems(open)} />}
                dock={chat}
              >
                {(['suggestions', 'outline', 'seo'] as const).map((value) => (
                  <TabPanel key={value} value={value}>
                    {panels[value]}
                  </TabPanel>
                ))}
              </EditorRail>
            </TabsRoot>
          }
        />
      )}
    </WorkbenchPage>
  );
}

function railItems(open: number | undefined) {
  return [
    { value: 'suggestions' as const, label: 'Suggestions', count: open },
    { value: 'outline' as const, label: 'Outline' },
    { value: 'seo' as const, label: 'SEO' },
  ];
}

function NarrowWorkspace({
  tab,
  onTab,
  open,
  page,
  panels,
  chat,
}: Readonly<{
  tab: StackTab;
  onTab: (tab: StackTab) => void;
  open: number | undefined;
  page: ReactNode;
  panels: Record<RailTab, ReactNode>;
  chat: ReactNode;
}>) {
  return (
    <TabsRoot value={tab} onValueChange={onTab} className="flex min-h-0 flex-col">
      <EditorStack
        tabs={
          <TabRow
            ariaLabel="Page workspace"
            items={[
              { value: 'page' as const, label: 'Page' },
              ...railItems(open),
              { value: 'chat' as const, label: 'Chat' },
            ]}
          />
        }
      >
        <TabPanel value="page" forceMount className="flex min-h-0 flex-1 flex-col">
          {page}
        </TabPanel>
        {(['suggestions', 'outline', 'seo'] as const).map((value) => (
          <TabPanel key={value} value={value} className="flex min-h-0 flex-1 flex-col">
            <EditorRail>{panels[value]}</EditorRail>
          </TabPanel>
        ))}
        <TabPanel value="chat" className="flex min-h-0 flex-1 flex-col">
          <EditorRail dock={chat} />
        </TabPanel>
      </EditorStack>
    </TabsRoot>
  );
}

function PageHead({
  status,
  draft,
  canAsk,
  onAsk,
}: Readonly<{
  status: string;
  draft: PageDraft;
  canAsk: boolean;
  onAsk: () => void;
}>) {
  return (
    <>
      <Inline className="flex-wrap justify-between">
        <span className={textRole('caption')} aria-live="polite">
          {status}
        </span>
        <Inline className="flex-wrap">
          <Button variant="quiet" disabled={!canAsk} onClick={onAsk}>
            <Icon icon={Sparkles} />
            Ask AI
          </Button>
          {draft.draft ? (
            <>
              <Button variant="quiet" disabled={draft.saving} onClick={draft.discard}>
                <Icon icon={Undo2} />
                Discard
              </Button>
              <Button
                variant="primary"
                pending={draft.saving}
                pendingLabel="Saving…"
                onClick={draft.save}
              >
                Save changes
              </Button>
            </>
          ) : null}
        </Inline>
      </Inline>
      {draft.moved && !draft.failure ? (
        <Notice tone="warning">
          The page changed since you started editing. Saving will be refused.
        </Notice>
      ) : null}
      {draft.failure ? <Notice kind="mutation" notice={draft.failure} /> : null}
    </>
  );
}
