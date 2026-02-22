// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileServerSetupWizard } from "./MobileServerSetupWizard";

afterEach(() => {
  cleanup();
});

function renderWizard(overrides?: Partial<ComponentProps<typeof MobileServerSetupWizard>>) {
  const props: ComponentProps<typeof MobileServerSetupWizard> = {
    remoteHostDraft: "127.0.0.1:4732",
    remoteTokenDraft: "",
    busy: false,
    checking: false,
    statusMessage: null,
    statusError: false,
    onClose: vi.fn(),
    onRemoteHostChange: vi.fn(),
    onRemoteTokenChange: vi.fn(),
    onConnectTest: vi.fn(),
    ...overrides,
  };
  render(<MobileServerSetupWizard {...props} />);
  return props;
}

describe("MobileServerSetupWizard", () => {
  it("moves focus from host to token when pressing Enter", () => {
    renderWizard();
    const hostInput = screen.getByLabelText("Tailscale host");
    const tokenInput = screen.getByLabelText("Remote backend token");

    hostInput.focus();
    fireEvent.keyDown(hostInput, { key: "Enter" });

    expect(document.activeElement).toBe(tokenInput);
  });

  it("submits when pressing Enter in token field", () => {
    const props = renderWizard();
    const tokenInput = screen.getByLabelText("Remote backend token");

    tokenInput.focus();
    fireEvent.keyDown(tokenInput, { key: "Enter" });

    expect(props.onConnectTest).toHaveBeenCalledTimes(1);
  });

  it("moves focus from close to host with ArrowDown", () => {
    renderWizard();
    const closeButton = screen.getByRole("button", { name: "Close mobile setup" });
    const hostInput = screen.getByLabelText("Tailscale host");

    closeButton.focus();
    fireEvent.keyDown(closeButton, { key: "ArrowDown" });

    expect(document.activeElement).toBe(hostInput);
  });
});
