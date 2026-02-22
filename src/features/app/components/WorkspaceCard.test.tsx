// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { WorkspaceCard } from "./WorkspaceCard";

const workspace: WorkspaceInfo = {
  id: "ws-1",
  name: "Workspace One",
  path: "/tmp/workspace-one",
  connected: false,
  settings: { sidebarCollapsed: false },
};

describe("WorkspaceCard", () => {
  it("does not trigger row keyboard selection when Enter is pressed on connect", () => {
    const onSelectWorkspace = vi.fn();

    render(
      <WorkspaceCard
        workspace={workspace}
        isActive={false}
        isCollapsed={false}
        addMenuOpen={false}
        addMenuWidth={200}
        onSelectWorkspace={onSelectWorkspace}
        onShowWorkspaceMenu={vi.fn()}
        onToggleWorkspaceCollapse={vi.fn()}
        onConnectWorkspace={vi.fn()}
        onToggleAddMenu={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "connect" }), {
      key: "Enter",
    });

    expect(onSelectWorkspace).not.toHaveBeenCalled();
  });
});
