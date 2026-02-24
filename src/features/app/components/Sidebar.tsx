import type {
  AccountSnapshot,
  RequestUserInputRequest,
  RateLimitSnapshot,
  ThreadListOrganizeMode,
  ThreadListSortKey,
  ThreadSummary,
  WorkspaceInfo,
} from "../../../types";
import { createPortal } from "react-dom";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";
import { FolderOpen } from "lucide-react";
import Copy from "lucide-react/dist/esm/icons/copy";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import Plus from "lucide-react/dist/esm/icons/plus";
import X from "lucide-react/dist/esm/icons/x";
import {
  PopoverMenuItem,
  PopoverSurface,
} from "../../design-system/components/popover/PopoverPrimitives";
import { SidebarCornerActions } from "./SidebarCornerActions";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarHeader } from "./SidebarHeader";
import { ThreadList } from "./ThreadList";
import { ThreadLoading } from "./ThreadLoading";
import { WorktreeSection } from "./WorktreeSection";
import { PinnedThreadList } from "./PinnedThreadList";
import { WorkspaceCard } from "./WorkspaceCard";
import { WorkspaceGroup } from "./WorkspaceGroup";
import { useCollapsedGroups } from "../hooks/useCollapsedGroups";
import { useMenuController } from "../hooks/useMenuController";
import { useSidebarMenus } from "../hooks/useSidebarMenus";
import { useSidebarScrollFade } from "../hooks/useSidebarScrollFade";
import { useThreadRows } from "../hooks/useThreadRows";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { getUsageLabels } from "../utils/usageLabels";
import { formatRelativeTimeShort } from "../../../utils/time";
import type { ThreadStatusById } from "../../../utils/threadStatus";

const COLLAPSED_GROUPS_STORAGE_KEY = "codexmonitor.collapsedGroups";
const UNGROUPED_COLLAPSE_ID = "__ungrouped__";
const ADD_MENU_WIDTH = 200;
const SIDEBAR_ROW_SELECTOR = ".workspace-row, .worktree-row, .thread-row";
const SIDEBAR_DPAD_FOCUS_SELECTOR = [
  ".sidebar-title-button",
  ".sidebar-title-add",
  ".sidebar-sort-toggle",
  ".sidebar-refresh-toggle",
  ".sidebar-search-toggle",
  ".sidebar-search-input",
  ".workspace-group-header.is-toggleable",
  ".workspace-row",
  ".worktree-row",
  ".thread-row",
  ".thread-more",
  ".sidebar-corner-button",
  ".sidebar-account-action",
  ".sidebar-account-cancel",
].join(", ");
const SIDEBAR_BACK_KEYS = new Set([
  "Escape",
  "Back",
  "BrowserBack",
  "GoBack",
  "TVBack",
]);

function isSidebarElementFocusable(element: HTMLElement): boolean {
  if (element.tabIndex < 0) {
    return false;
  }
  if (element.closest("[inert]")) {
    return false;
  }
  if ("disabled" in element && (element as HTMLButtonElement).disabled) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number.parseFloat(style.opacity || "1") === 0
  ) {
    return false;
  }
  return element.getClientRects().length > 0;
}

function getSidebarFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(SIDEBAR_DPAD_FOCUS_SELECTOR)).filter(
    isSidebarElementFocusable,
  );
}

function parseThreadDepth(element: HTMLElement): number {
  const value = Number.parseInt(element.dataset.threadDepth ?? "0", 10);
  return Number.isFinite(value) ? value : 0;
}

type WorkspaceGroupSection = {
  id: string | null;
  name: string;
  workspaces: WorkspaceInfo[];
};

type SidebarProps = {
  isAndroidRuntime: boolean;
  workspaces: WorkspaceInfo[];
  groupedWorkspaces: WorkspaceGroupSection[];
  hasWorkspaceGroups: boolean;
  deletingWorktreeIds: Set<string>;
  newAgentDraftWorkspaceId?: string | null;
  startingDraftThreadWorkspaceId?: string | null;
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  threadParentById: Record<string, string>;
  threadStatusById: ThreadStatusById;
  threadListLoadingByWorkspace: Record<string, boolean>;
  threadListPagingByWorkspace: Record<string, boolean>;
  threadListCursorByWorkspace: Record<string, string | null>;
  pinnedThreadsVersion: number;
  threadListSortKey: ThreadListSortKey;
  onSetThreadListSortKey: (sortKey: ThreadListSortKey) => void;
  threadListOrganizeMode: ThreadListOrganizeMode;
  onSetThreadListOrganizeMode: (organizeMode: ThreadListOrganizeMode) => void;
  onRefreshAllThreads: () => void;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  userInputRequests?: RequestUserInputRequest[];
  accountRateLimits: RateLimitSnapshot | null;
  usageShowRemaining: boolean;
  accountInfo: AccountSnapshot | null;
  onSwitchAccount: () => void;
  onCancelSwitchAccount: () => void;
  accountSwitching: boolean;
  onOpenSettings: () => void;
  onOpenDebug: () => void;
  showDebugButton: boolean;
  onAddWorkspace: () => void;
  onSelectHome: () => void;
  onSelectWorkspace: (id: string) => void;
  onConnectWorkspace: (workspace: WorkspaceInfo) => void;
  onAddAgent: (workspace: WorkspaceInfo) => void;
  onAddWorktreeAgent: (workspace: WorkspaceInfo) => void;
  onAddCloneAgent: (workspace: WorkspaceInfo) => void;
  onToggleWorkspaceCollapse: (workspaceId: string, collapsed: boolean) => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onDeleteThread: (workspaceId: string, threadId: string) => void;
  onSyncThread: (workspaceId: string, threadId: string) => void;
  pinThread: (workspaceId: string, threadId: string) => boolean;
  unpinThread: (workspaceId: string, threadId: string) => void;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  getPinTimestamp: (workspaceId: string, threadId: string) => number | null;
  getThreadArgsBadge?: (workspaceId: string, threadId: string) => string | null;
  onRenameThread: (workspaceId: string, threadId: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onDeleteWorktree: (workspaceId: string) => void;
  onLoadOlderThreads: (workspaceId: string) => void;
  onReloadWorkspaceThreads: (workspaceId: string) => void;
  workspaceDropTargetRef: RefObject<HTMLElement | null>;
  isWorkspaceDropActive: boolean;
  workspaceDropText: string;
  onWorkspaceDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDragEnter: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDrop: (event: React.DragEvent<HTMLElement>) => void;
};

export const Sidebar = memo(function Sidebar({
  isAndroidRuntime,
  workspaces,
  groupedWorkspaces,
  hasWorkspaceGroups,
  deletingWorktreeIds,
  newAgentDraftWorkspaceId = null,
  startingDraftThreadWorkspaceId = null,
  threadsByWorkspace,
  threadParentById,
  threadStatusById,
  threadListLoadingByWorkspace,
  threadListPagingByWorkspace,
  threadListCursorByWorkspace,
  pinnedThreadsVersion,
  threadListSortKey,
  onSetThreadListSortKey,
  threadListOrganizeMode,
  onSetThreadListOrganizeMode,
  onRefreshAllThreads,
  activeWorkspaceId,
  activeThreadId,
  userInputRequests = [],
  accountRateLimits,
  usageShowRemaining,
  accountInfo,
  onSwitchAccount,
  onCancelSwitchAccount,
  accountSwitching,
  onOpenSettings,
  onOpenDebug,
  showDebugButton,
  onAddWorkspace,
  onSelectHome,
  onSelectWorkspace,
  onConnectWorkspace,
  onAddAgent,
  onAddWorktreeAgent,
  onAddCloneAgent,
  onToggleWorkspaceCollapse,
  onSelectThread,
  onDeleteThread,
  onSyncThread,
  pinThread,
  unpinThread,
  isThreadPinned,
  getPinTimestamp,
  getThreadArgsBadge,
  onRenameThread,
  onDeleteWorkspace,
  onDeleteWorktree,
  onLoadOlderThreads,
  onReloadWorkspaceThreads,
  workspaceDropTargetRef,
  isWorkspaceDropActive,
  workspaceDropText,
  onWorkspaceDragOver,
  onWorkspaceDragEnter,
  onWorkspaceDragLeave,
  onWorkspaceDrop,
}: SidebarProps) {
  const [expandedWorkspaces, setExpandedWorkspaces] = useState(
    new Set<string>(),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [addMenuAnchor, setAddMenuAnchor] = useState<{
    workspaceId: string;
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const addMenuController = useMenuController({
    open: Boolean(addMenuAnchor),
    onDismiss: () => setAddMenuAnchor(null),
  });
  const { containerRef: addMenuRef } = addMenuController;
  const { collapsedGroups, toggleGroupCollapse } = useCollapsedGroups(
    COLLAPSED_GROUPS_STORAGE_KEY,
  );
  const { getThreadRows } = useThreadRows(threadParentById);
  const { showThreadMenu, showWorkspaceMenu, showWorktreeMenu } =
    useSidebarMenus({
      onDeleteThread,
      onSyncThread,
      onPinThread: pinThread,
      onUnpinThread: unpinThread,
      isThreadPinned,
      onRenameThread,
      onReloadWorkspaceThreads,
      onDeleteWorkspace,
      onDeleteWorktree,
    });
  const {
    sessionPercent,
    weeklyPercent,
    sessionResetLabel,
    weeklyResetLabel,
    creditsLabel,
    showWeekly,
  } = getUsageLabels(accountRateLimits, usageShowRemaining);
  const debouncedQuery = useDebouncedValue(searchQuery, 150);
  const normalizedQuery = debouncedQuery.trim().toLowerCase();
  const pendingUserInputKeys = useMemo(
    () =>
      new Set(
        userInputRequests
          .map((request) => {
            const workspaceId = request.workspace_id.trim();
            const threadId = request.params.thread_id.trim();
            return workspaceId && threadId ? `${workspaceId}:${threadId}` : "";
          })
          .filter(Boolean),
      ),
    [userInputRequests],
  );

  const isWorkspaceMatch = useCallback(
    (workspace: WorkspaceInfo) => {
      if (!normalizedQuery) {
        return true;
      }
      return workspace.name.toLowerCase().includes(normalizedQuery);
    },
    [normalizedQuery],
  );

  const renderHighlightedName = useCallback(
    (name: string) => {
      if (!normalizedQuery) {
        return name;
      }
      const lower = name.toLowerCase();
      const parts: React.ReactNode[] = [];
      let cursor = 0;
      let matchIndex = lower.indexOf(normalizedQuery, cursor);

      while (matchIndex !== -1) {
        if (matchIndex > cursor) {
          parts.push(name.slice(cursor, matchIndex));
        }
        parts.push(
          <span key={`${matchIndex}-${cursor}`} className="workspace-name-match">
            {name.slice(matchIndex, matchIndex + normalizedQuery.length)}
          </span>,
        );
        cursor = matchIndex + normalizedQuery.length;
        matchIndex = lower.indexOf(normalizedQuery, cursor);
      }

      if (cursor < name.length) {
        parts.push(name.slice(cursor));
      }

      return parts.length ? parts : name;
    },
    [normalizedQuery],
  );

  const accountEmail = accountInfo?.email?.trim() ?? "";
  const accountButtonLabel = accountEmail
    ? accountEmail
    : accountInfo?.type === "apikey"
      ? "API key"
      : "Sign in to Codex";
  const accountActionLabel = accountEmail ? "Switch account" : "Sign in";
  const showAccountSwitcher = Boolean(activeWorkspaceId);
  const accountSwitchDisabled = accountSwitching || !activeWorkspaceId;
  const accountCancelDisabled = !accountSwitching || !activeWorkspaceId;
  const refreshDisabled = workspaces.length === 0 || workspaces.every((workspace) => !workspace.connected);
  const refreshInProgress = workspaces.some(
    (workspace) => threadListLoadingByWorkspace[workspace.id] ?? false,
  );

  const pinnedThreadRows = useMemo(() => {
    type ThreadRow = { thread: ThreadSummary; depth: number };
    const groups: Array<{
      pinTime: number;
      workspaceId: string;
      rows: ThreadRow[];
    }> = [];

    workspaces.forEach((workspace) => {
      if (!isWorkspaceMatch(workspace)) {
        return;
      }
      const threads = threadsByWorkspace[workspace.id] ?? [];
      if (!threads.length) {
        return;
      }
      const { pinnedRows } = getThreadRows(
        threads,
        true,
        workspace.id,
        getPinTimestamp,
        pinnedThreadsVersion,
      );
      if (!pinnedRows.length) {
        return;
      }
      let currentRows: ThreadRow[] = [];
      let currentPinTime: number | null = null;

      pinnedRows.forEach((row) => {
        if (row.depth === 0) {
          if (currentRows.length && currentPinTime !== null) {
            groups.push({
              pinTime: currentPinTime,
              workspaceId: workspace.id,
              rows: currentRows,
            });
          }
          currentRows = [row];
          currentPinTime = getPinTimestamp(workspace.id, row.thread.id);
        } else {
          currentRows.push(row);
        }
      });

      if (currentRows.length && currentPinTime !== null) {
        groups.push({
          pinTime: currentPinTime,
          workspaceId: workspace.id,
          rows: currentRows,
        });
      }
    });

    return groups
      .sort((a, b) => a.pinTime - b.pinTime)
      .flatMap((group) =>
        group.rows.map((row) => ({
          ...row,
          workspaceId: group.workspaceId,
        })),
      );
  }, [
    workspaces,
    threadsByWorkspace,
    getThreadRows,
    getPinTimestamp,
    pinnedThreadsVersion,
    isWorkspaceMatch,
  ]);

  const scrollFadeDeps = useMemo(
    () => [groupedWorkspaces, threadsByWorkspace, expandedWorkspaces, normalizedQuery],
    [groupedWorkspaces, threadsByWorkspace, expandedWorkspaces, normalizedQuery],
  );
  const { sidebarBodyRef, scrollFade, updateScrollFade } =
    useSidebarScrollFade(scrollFadeDeps);

  const filteredGroupedWorkspaces = useMemo(
    () =>
      groupedWorkspaces
        .map((group) => ({
          ...group,
          workspaces: group.workspaces.filter(isWorkspaceMatch),
        }))
        .filter((group) => group.workspaces.length > 0),
    [groupedWorkspaces, isWorkspaceMatch],
  );

  const objectiveCount = groupedWorkspaces.length;
  const workstreamCount = workspaces.filter(
    (entry) => (entry.kind ?? "main") !== "worktree" && !entry.parentId,
  ).length;
  const navigationSummary = `${objectiveCount} objective${
    objectiveCount === 1 ? "" : "s"
  } · ${workstreamCount} workstream${workstreamCount === 1 ? "" : "s"}`;

  const isSearchActive = Boolean(normalizedQuery);

  const worktreesByParent = useMemo(() => {
    const worktrees = new Map<string, WorkspaceInfo[]>();
    workspaces
      .filter((entry) => (entry.kind ?? "main") === "worktree" && entry.parentId)
      .forEach((entry) => {
        const parentId = entry.parentId as string;
        const list = worktrees.get(parentId) ?? [];
        list.push(entry);
        worktrees.set(parentId, list);
      });
    worktrees.forEach((entries) => {
      entries.sort((a, b) => a.name.localeCompare(b.name));
    });
    return worktrees;
  }, [workspaces]);

  const handleToggleExpanded = useCallback((workspaceId: string) => {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      return next;
    });
  }, []);

  const getThreadTime = useCallback(
    (thread: ThreadSummary) => {
      const timestamp = thread.updatedAt ?? null;
      return timestamp ? formatRelativeTimeShort(timestamp) : null;
    },
    [],
  );

  useEffect(() => {
    if (!addMenuAnchor) {
      return;
    }
    function handleScroll() {
      setAddMenuAnchor(null);
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [addMenuAnchor]);

  useEffect(() => {
    if (!isSearchOpen && searchQuery) {
      setSearchQuery("");
    }
  }, [isSearchOpen, searchQuery]);

  const handleSidebarDirectionalNav = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (!isAndroidRuntime) {
        return;
      }
      const key = event.key;
      const isVerticalMove = key === "ArrowDown" || key === "ArrowUp";
      const isHorizontalMove = key === "ArrowLeft" || key === "ArrowRight";
      const isBackKey = SIDEBAR_BACK_KEYS.has(key);
      if (!isVerticalMove && !isHorizontalMove && !isBackKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      const tag = target.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target.isContentEditable
      ) {
        if (key === "Escape" && isSearchOpen) {
          event.preventDefault();
          setIsSearchOpen(false);
        }
        return;
      }

      if (isBackKey) {
        if (addMenuAnchor) {
          event.preventDefault();
          setAddMenuAnchor(null);
          return;
        }
        if (isSearchOpen) {
          event.preventDefault();
          setIsSearchOpen(false);
          return;
        }
        if (activeThreadId && activeWorkspaceId) {
          event.preventDefault();
          onSelectWorkspace(activeWorkspaceId);
          return;
        }
        if (activeWorkspaceId) {
          event.preventDefault();
          onSelectHome();
        }
        return;
      }

      const root = event.currentTarget;
      const focusables = getSidebarFocusableElements(root);
      if (!focusables.length) {
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      const current =
        (active && root.contains(active) ? active : null) ??
        target.closest<HTMLElement>(SIDEBAR_DPAD_FOCUS_SELECTOR);
      if (!current) {
        return;
      }

      if (isVerticalMove) {
        const currentIndex = focusables.indexOf(current);
        const direction = key === "ArrowDown" ? 1 : -1;
        let nextIndex = currentIndex + direction;
        if (currentIndex === -1) {
          nextIndex = direction > 0 ? 0 : focusables.length - 1;
        } else if (nextIndex < 0) {
          nextIndex = focusables.length - 1;
        } else if (nextIndex >= focusables.length) {
          nextIndex = 0;
        }
        const next = focusables[nextIndex];
        if (!next || next === current) {
          return;
        }
        event.preventDefault();
        next.focus();
        return;
      }

      const currentRow = current.closest<HTMLElement>(SIDEBAR_ROW_SELECTOR);
      if (!currentRow) {
        return;
      }

      const focusFirstDescendant = () => {
        const card = currentRow.closest(".workspace-card, .worktree-card");
        if (!card) {
          return false;
        }
        const next = Array.from(
          card.querySelectorAll<HTMLElement>(
            ".workspace-card-content .worktree-row, .workspace-card-content .thread-row, .workspace-card-content .thread-more, .worktree-card-content .thread-row, .worktree-card-content .thread-more",
          ),
        ).find(isSidebarElementFocusable);
        if (!next) {
          return false;
        }
        next.focus();
        return true;
      };

      if (key === "ArrowRight") {
        if (currentRow.matches(".workspace-row, .worktree-row")) {
          const isExpanded = currentRow.getAttribute("aria-expanded") === "true";
          const toggle = currentRow.querySelector<HTMLButtonElement>(
            ".workspace-toggle, .worktree-toggle",
          );
          if (!isExpanded && toggle) {
            event.preventDefault();
            toggle.click();
            window.setTimeout(() => {
              focusFirstDescendant();
            }, 0);
            return;
          }
          if (focusFirstDescendant()) {
            event.preventDefault();
          }
          return;
        }

        if (currentRow.matches(".thread-row")) {
          const threadList = currentRow.closest(".thread-list");
          if (!threadList) {
            return;
          }
          const rows = Array.from(
            threadList.querySelectorAll<HTMLElement>(".thread-row"),
          );
          const currentIndex = rows.indexOf(currentRow);
          if (currentIndex === -1) {
            return;
          }
          const depth = parseThreadDepth(currentRow);
          for (let index = currentIndex + 1; index < rows.length; index += 1) {
            const candidate = rows[index];
            const candidateDepth = parseThreadDepth(candidate);
            if (candidateDepth <= depth) {
              break;
            }
            if (
              candidateDepth === depth + 1 &&
              isSidebarElementFocusable(candidate)
            ) {
              event.preventDefault();
              candidate.focus();
              return;
            }
          }
        }
        return;
      }

      if (!currentRow.matches(".thread-row")) {
        const isExpanded = currentRow.getAttribute("aria-expanded") === "true";
        const toggle = currentRow.querySelector<HTMLButtonElement>(
          ".workspace-toggle, .worktree-toggle",
        );
        if (isExpanded && toggle) {
          event.preventDefault();
          toggle.click();
          return;
        }
        if (currentRow.matches(".worktree-row")) {
          const parentWorkspace = currentRow
            .closest(".worktree-section")
            ?.closest(".workspace-card")
            ?.querySelector<HTMLElement>(".workspace-row");
          if (parentWorkspace && isSidebarElementFocusable(parentWorkspace)) {
            event.preventDefault();
            parentWorkspace.focus();
          }
        }
        return;
      }

      const threadList = currentRow.closest(".thread-list");
      if (threadList) {
        const rows = Array.from(threadList.querySelectorAll<HTMLElement>(".thread-row"));
        const currentIndex = rows.indexOf(currentRow);
        const depth = parseThreadDepth(currentRow);
        if (currentIndex !== -1 && depth > 0) {
          for (let index = currentIndex - 1; index >= 0; index -= 1) {
            const candidate = rows[index];
            const candidateDepth = parseThreadDepth(candidate);
            if (candidateDepth === depth - 1 && isSidebarElementFocusable(candidate)) {
              event.preventDefault();
              candidate.focus();
              return;
            }
            if (candidateDepth < depth - 1) {
              break;
            }
          }
        }
      }

      const workspaceId = currentRow.dataset.workspaceId?.trim();
      if (!workspaceId) {
        return;
      }
      const ownerRow =
        currentRow
          .closest(".workspace-card, .worktree-card")
          ?.querySelector<HTMLElement>(".workspace-row, .worktree-row") ??
        Array.from(
          root.querySelectorAll<HTMLElement>(".workspace-row, .worktree-row"),
        ).find((row) => row.dataset.workspaceId === workspaceId);
      if (ownerRow && isSidebarElementFocusable(ownerRow)) {
        event.preventDefault();
        ownerRow.focus();
      }
    },
    [
      activeThreadId,
      activeWorkspaceId,
      addMenuAnchor,
      isAndroidRuntime,
      isSearchOpen,
      onSelectHome,
      onSelectWorkspace,
    ],
  );

  return (
    <aside
      className={`sidebar${isSearchOpen ? " search-open" : ""}`}
      ref={workspaceDropTargetRef}
      onKeyDownCapture={isAndroidRuntime ? handleSidebarDirectionalNav : undefined}
      onDragOver={onWorkspaceDragOver}
      onDragEnter={onWorkspaceDragEnter}
      onDragLeave={onWorkspaceDragLeave}
      onDrop={onWorkspaceDrop}
    >
      <SidebarHeader
        onSelectHome={onSelectHome}
        onAddWorkspace={onAddWorkspace}
        onToggleSearch={() => setIsSearchOpen((prev) => !prev)}
        isSearchOpen={isSearchOpen}
        navigationSummary={navigationSummary}
        threadListSortKey={threadListSortKey}
        onSetThreadListSortKey={onSetThreadListSortKey}
        threadListOrganizeMode={threadListOrganizeMode}
        onSetThreadListOrganizeMode={onSetThreadListOrganizeMode}
        onRefreshAllThreads={onRefreshAllThreads}
        refreshDisabled={refreshDisabled || refreshInProgress}
        refreshInProgress={refreshInProgress}
      />
      <div className={`sidebar-search${isSearchOpen ? " is-open" : ""}`}>
        {isSearchOpen && (
          <input
            className="sidebar-search-input"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search workstreams"
            aria-label="Search workstreams"
            data-tauri-drag-region="false"
            autoFocus
          />
        )}
        {isSearchOpen && searchQuery.length > 0 && (
          <button
            type="button"
            className="sidebar-search-clear"
            onClick={() => setSearchQuery("")}
            aria-label="Clear search"
            data-tauri-drag-region="false"
          >
            <X size={12} aria-hidden />
          </button>
        )}
      </div>
      <div
        className={`workspace-drop-overlay${
          isWorkspaceDropActive ? " is-active" : ""
        }`}
        aria-hidden
      >
        <div
          className={`workspace-drop-overlay-text${
            workspaceDropText.toLowerCase().startsWith("adding ") ? " is-busy" : ""
          }`}
        >
          {workspaceDropText.toLowerCase().startsWith("drop ") && (
            <FolderOpen className="workspace-drop-overlay-icon" aria-hidden />
          )}
          {workspaceDropText}
        </div>
      </div>
      <div
        className={`sidebar-body${scrollFade.top ? " fade-top" : ""}${
          scrollFade.bottom ? " fade-bottom" : ""
        }`}
        onScroll={updateScrollFade}
        ref={sidebarBodyRef}
      >
        <div className="workspace-list">
          {pinnedThreadRows.length > 0 && (
            <div className="pinned-section">
              <div className="workspace-group-header">
                <div className="workspace-group-label">Pinned</div>
              </div>
              <PinnedThreadList
                rows={pinnedThreadRows}
                activeWorkspaceId={activeWorkspaceId}
                activeThreadId={activeThreadId}
                threadStatusById={threadStatusById}
                pendingUserInputKeys={pendingUserInputKeys}
                getThreadTime={getThreadTime}
                getThreadArgsBadge={getThreadArgsBadge}
                isThreadPinned={isThreadPinned}
                onSelectThread={onSelectThread}
                onShowThreadMenu={showThreadMenu}
              />
            </div>
          )}
          {filteredGroupedWorkspaces.map((group) => {
            const groupId = group.id;
            const showGroupHeader = Boolean(groupId) || hasWorkspaceGroups;
            const toggleId = groupId ?? (showGroupHeader ? UNGROUPED_COLLAPSE_ID : null);
            const isGroupCollapsed = Boolean(
              toggleId && collapsedGroups.has(toggleId),
            );

            return (
              <WorkspaceGroup
                key={group.id ?? "ungrouped"}
                toggleId={toggleId}
                name={group.name}
                showHeader={showGroupHeader}
                isCollapsed={isGroupCollapsed}
                onToggleCollapse={toggleGroupCollapse}
              >
                {group.workspaces.map((entry) => {
                  const threads = threadsByWorkspace[entry.id] ?? [];
                  const isCollapsed = entry.settings.sidebarCollapsed;
                  const isExpanded = expandedWorkspaces.has(entry.id);
                  const {
                    unpinnedRows,
                    totalRoots: totalThreadRoots,
                  } = getThreadRows(
                    threads,
                    isExpanded,
                    entry.id,
                    getPinTimestamp,
                    pinnedThreadsVersion,
                  );
                  const nextCursor =
                    threadListCursorByWorkspace[entry.id] ?? null;
                  const showThreadList =
                    threads.length > 0 || Boolean(nextCursor);
                  const isLoadingThreads =
                    threadListLoadingByWorkspace[entry.id] ?? false;
                  const showThreadLoader =
                    isLoadingThreads && threads.length === 0;
                  const isPaging = threadListPagingByWorkspace[entry.id] ?? false;
                  const worktrees = worktreesByParent.get(entry.id) ?? [];
                  const addMenuOpen = addMenuAnchor?.workspaceId === entry.id;
                  const isDraftNewAgent = newAgentDraftWorkspaceId === entry.id;
                  const isDraftRowActive =
                    isDraftNewAgent &&
                    entry.id === activeWorkspaceId &&
                    !activeThreadId;
                  const draftStatusClass =
                    startingDraftThreadWorkspaceId === entry.id
                      ? "processing"
                      : "ready";

                  return (
                    <WorkspaceCard
                      key={entry.id}
                      workspace={entry}
                      workspaceName={renderHighlightedName(entry.name)}
                      isActive={entry.id === activeWorkspaceId}
                      isCollapsed={isCollapsed}
                      addMenuOpen={addMenuOpen}
                      addMenuWidth={ADD_MENU_WIDTH}
                      onSelectWorkspace={onSelectWorkspace}
                      onShowWorkspaceMenu={showWorkspaceMenu}
                      onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
                      onConnectWorkspace={onConnectWorkspace}
                      onToggleAddMenu={setAddMenuAnchor}
                    >
                      {addMenuOpen && addMenuAnchor &&
                        createPortal(
                          <PopoverSurface
                            className="workspace-add-menu"
                            ref={addMenuRef}
                            style={{
                              top: addMenuAnchor.top,
                              left: addMenuAnchor.left,
                              width: addMenuAnchor.width,
                            }}
                          >
                            <PopoverMenuItem
                              className="workspace-add-option"
                              onClick={(event) => {
                                event.stopPropagation();
                                setAddMenuAnchor(null);
                                onAddAgent(entry);
                              }}
                              icon={<Plus aria-hidden />}
                            >
                              New agent
                            </PopoverMenuItem>
                            <PopoverMenuItem
                              className="workspace-add-option"
                              onClick={(event) => {
                                event.stopPropagation();
                                setAddMenuAnchor(null);
                                onAddWorktreeAgent(entry);
                              }}
                              icon={<GitBranch aria-hidden />}
                            >
                              New worktree agent
                            </PopoverMenuItem>
                            <PopoverMenuItem
                              className="workspace-add-option"
                              onClick={(event) => {
                                event.stopPropagation();
                                setAddMenuAnchor(null);
                                onAddCloneAgent(entry);
                              }}
                              icon={<Copy aria-hidden />}
                            >
                              New clone agent
                            </PopoverMenuItem>
                          </PopoverSurface>,
                          document.body,
                        )}
                      {isDraftNewAgent && (
                        <button
                          type="button"
                          className={`thread-row thread-row-draft${
                            isDraftRowActive ? " active" : ""
                          }`}
                          data-focus-kind="thread"
                          data-workspace-id={entry.id}
                          data-thread-id="new-agent"
                          data-thread-depth="0"
                          onClick={() => onSelectWorkspace(entry.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onSelectWorkspace(entry.id);
                            }
                          }}
                        >
                          <span className={`thread-status ${draftStatusClass}`} aria-hidden />
                          <span className="thread-name">New Agent</span>
                        </button>
                      )}
                      {worktrees.length > 0 && (
                        <WorktreeSection
                          worktrees={worktrees}
                          deletingWorktreeIds={deletingWorktreeIds}
                          threadsByWorkspace={threadsByWorkspace}
                          threadStatusById={threadStatusById}
                          threadListLoadingByWorkspace={threadListLoadingByWorkspace}
                          threadListPagingByWorkspace={threadListPagingByWorkspace}
                          threadListCursorByWorkspace={threadListCursorByWorkspace}
                          expandedWorkspaces={expandedWorkspaces}
                          activeWorkspaceId={activeWorkspaceId}
                          activeThreadId={activeThreadId}
                          pendingUserInputKeys={pendingUserInputKeys}
                          getThreadRows={getThreadRows}
                          getThreadTime={getThreadTime}
                          getThreadArgsBadge={getThreadArgsBadge}
                          isThreadPinned={isThreadPinned}
                          getPinTimestamp={getPinTimestamp}
                          pinnedThreadsVersion={pinnedThreadsVersion}
                          onSelectWorkspace={onSelectWorkspace}
                          onConnectWorkspace={onConnectWorkspace}
                          onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
                          onSelectThread={onSelectThread}
                          onShowThreadMenu={showThreadMenu}
                          onShowWorktreeMenu={showWorktreeMenu}
                          onToggleExpanded={handleToggleExpanded}
                          onLoadOlderThreads={onLoadOlderThreads}
                        />
                      )}
                      {showThreadList && (
                        <ThreadList
                          workspaceId={entry.id}
                          pinnedRows={[]}
                          unpinnedRows={unpinnedRows}
                          totalThreadRoots={totalThreadRoots}
                          isExpanded={isExpanded}
                          nextCursor={nextCursor}
                          isPaging={isPaging}
                          activeWorkspaceId={activeWorkspaceId}
                          activeThreadId={activeThreadId}
                          threadStatusById={threadStatusById}
                          pendingUserInputKeys={pendingUserInputKeys}
                          getThreadTime={getThreadTime}
                          getThreadArgsBadge={getThreadArgsBadge}
                          isThreadPinned={isThreadPinned}
                          onToggleExpanded={handleToggleExpanded}
                          onLoadOlderThreads={onLoadOlderThreads}
                          onSelectThread={onSelectThread}
                          onShowThreadMenu={showThreadMenu}
                        />
                      )}
                      {showThreadLoader && <ThreadLoading />}
                    </WorkspaceCard>
                  );
                })}
              </WorkspaceGroup>
            );
          })}
          {!filteredGroupedWorkspaces.length && (
            <div className="empty">
              {isSearchActive
                ? "No workstreams match your search."
                : "Add a workspace to start."}
            </div>
          )}
        </div>
      </div>
      <SidebarFooter
        sessionPercent={sessionPercent}
        weeklyPercent={weeklyPercent}
        sessionResetLabel={sessionResetLabel}
        weeklyResetLabel={weeklyResetLabel}
        creditsLabel={creditsLabel}
        showWeekly={showWeekly}
      />
      <SidebarCornerActions
        onOpenSettings={onOpenSettings}
        onOpenDebug={onOpenDebug}
        showDebugButton={showDebugButton}
        showAccountSwitcher={showAccountSwitcher}
        accountLabel={accountButtonLabel}
        accountActionLabel={accountActionLabel}
        accountDisabled={accountSwitchDisabled}
        accountSwitching={accountSwitching}
        accountCancelDisabled={accountCancelDisabled}
        onSwitchAccount={onSwitchAccount}
        onCancelSwitchAccount={onCancelSwitchAccount}
      />
    </aside>
  );
});

Sidebar.displayName = "Sidebar";
