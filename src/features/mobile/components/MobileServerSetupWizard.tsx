import { useEffect, useRef } from "react";
import "../../../styles/mobile-setup-wizard.css";
import X from "lucide-react/dist/esm/icons/x";
import { ModalShell } from "../../design-system/components/modal/ModalShell";

export type MobileServerSetupWizardProps = {
  remoteHostDraft: string;
  remoteTokenDraft: string;
  busy: boolean;
  checking: boolean;
  statusMessage: string | null;
  statusError: boolean;
  onClose: () => void;
  onRemoteHostChange: (value: string) => void;
  onRemoteTokenChange: (value: string) => void;
  onConnectTest: () => void;
};

export function MobileServerSetupWizard({
  remoteHostDraft,
  remoteTokenDraft,
  busy,
  checking,
  statusMessage,
  statusError,
  onClose,
  onRemoteHostChange,
  onRemoteTokenChange,
  onConnectTest,
}: MobileServerSetupWizardProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const hostInputRef = useRef<HTMLInputElement | null>(null);
  const tokenInputRef = useRef<HTMLInputElement | null>(null);
  const actionButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      hostInputRef.current?.focus();
    }, 40);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <ModalShell
      className="mobile-setup-wizard-overlay"
      cardClassName="mobile-setup-wizard-card"
      onBackdropClick={onClose}
      ariaLabel="Mobile server setup"
    >
      <div className="mobile-setup-wizard-header">
        <button
          type="button"
          className="ghost icon-button mobile-setup-wizard-close"
          onClick={onClose}
          aria-label="Close mobile setup"
          ref={closeButtonRef}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              hostInputRef.current?.focus();
            }
          }}
        >
          <X aria-hidden />
        </button>
        <div className="mobile-setup-wizard-kicker">Mobile Setup Required</div>
        <h2 className="mobile-setup-wizard-title">Connect to your desktop backend</h2>
        <p className="mobile-setup-wizard-subtitle">
          Complete this setup before using the app. Use the same connection details configured on
          your desktop CodexMonitor server settings.
        </p>
      </div>

      <div className="mobile-setup-wizard-body">
        <label className="mobile-setup-wizard-label" htmlFor="mobile-setup-host">
          Tailscale host
        </label>
        <input
          id="mobile-setup-host"
          className="mobile-setup-wizard-input"
          value={remoteHostDraft}
          placeholder="macbook.your-tailnet.ts.net:4732"
          onChange={(event) => onRemoteHostChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "ArrowDown") {
              event.preventDefault();
              tokenInputRef.current?.focus();
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              closeButtonRef.current?.focus();
            }
          }}
          disabled={busy || checking}
          ref={hostInputRef}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
        />

        <label className="mobile-setup-wizard-label" htmlFor="mobile-setup-token">
          Remote backend token
        </label>
        <input
          id="mobile-setup-token"
          type="password"
          className="mobile-setup-wizard-input"
          value={remoteTokenDraft}
          placeholder="Token"
          onChange={(event) => onRemoteTokenChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onConnectTest();
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              hostInputRef.current?.focus();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              actionButtonRef.current?.focus();
            }
          }}
          disabled={busy || checking}
          ref={tokenInputRef}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
        />

        <button
          type="button"
          className="button primary mobile-setup-wizard-action"
          onClick={onConnectTest}
          disabled={busy || checking}
          ref={actionButtonRef}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              tokenInputRef.current?.focus();
            }
          }}
        >
          {checking ? "Checking..." : busy ? "Connecting..." : "Connect & test"}
        </button>

        {statusMessage ? (
          <div
            className={`mobile-setup-wizard-status${
              statusError ? " mobile-setup-wizard-status-error" : ""
            }`}
            role="status"
            aria-live="polite"
          >
            {statusMessage}
          </div>
        ) : null}

        <div className="mobile-setup-wizard-hint">
          Use the Tailscale host from desktop Server settings and keep the desktop daemon running.
        </div>
      </div>
    </ModalShell>
  );
}
