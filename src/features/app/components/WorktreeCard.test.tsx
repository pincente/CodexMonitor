// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { WorktreeCard } from "./WorktreeCard";

const worktree: WorkspaceInfo = {
  id: "wt-1",
  name: "Worktree One",
  path: "/tmp/worktree-one",
  connected: false,
  kind: "worktree",
  worktree: { branch: "feature/test" },
  settings: { sidebarCollapsed: false },
};

describe("WorktreeCard", () => {
  it("does not trigger row keyboard selection when Enter is pressed on connect", () => {
    const onSelectWorkspace = vi.fn();

    render(
      <WorktreeCard
        worktree={worktree}
        isActive={false}
        onSelectWorkspace={onSelectWorkspace}
        onShowWorktreeMenu={vi.fn()}
        onToggleWorkspaceCollapse={vi.fn()}
        onConnectWorkspace={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "connect" }), {
      key: "Enter",
    });

    expect(onSelectWorkspace).not.toHaveBeenCalled();
  });
});
