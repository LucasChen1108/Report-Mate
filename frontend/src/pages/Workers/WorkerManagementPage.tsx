import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import type {
  GeneratedJoinCode,
  JoinCode,
  WorkerSummary,
} from "../../auth/contracts";
import { isServiceError } from "../../services/errors";
import { useServices } from "../../services/ServiceProvider";
import "../roleManagement.css";

export function WorkerManagementPage() {
  const { workers: workerService } = useServices();
  const { handleSessionError } = useAuth();
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [joinCodes, setJoinCodes] = useState<JoinCode[]>([]);
  const [generatedCode, setGeneratedCode] = useState<GeneratedJoinCode | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pendingWorkerIds, setPendingWorkerIds] = useState<Set<string>>(new Set());
  const [pendingCodeIds, setPendingCodeIds] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const actionAlertRef = useRef<HTMLDivElement>(null);
  const pendingWorkerRefs = useRef(new Set<string>());
  const pendingCodeRefs = useRef(new Set<string>());
  const generatePendingRef = useRef(false);

  useEffect(() => {
    if (actionError) actionAlertRef.current?.focus();
  }, [actionError]);

  const loadManagementData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [linkedWorkers, codes] = await Promise.all([
        workerService.listWorkers(),
        workerService.listJoinCodes(),
      ]);
      setWorkers(linkedWorkers);
      setJoinCodes(codes);
    } catch (error) {
      if (!(await handleSessionError(error))) {
        setLoadError(getManagementErrorMessage(error, "load"));
      }
    } finally {
      setIsLoading(false);
    }
  }, [handleSessionError, workerService]);

  useEffect(() => {
    void loadManagementData();
  }, [loadManagementData]);

  const beginAction = () => {
    setActionError(null);
    setSuccessMessage(null);
  };

  const handleWorkerStatus = async (worker: WorkerSummary) => {
    if (pendingWorkerRefs.current.has(worker.id)) return;
    pendingWorkerRefs.current.add(worker.id);
    setPendingWorkerIds((current) => new Set(current).add(worker.id));
    beginAction();
    try {
      const updated = await workerService.updateWorkerStatus(worker.id, {
        isActive: !worker.isActive,
      });
      setWorkers((current) => current.map((item) => (
        item.id === updated.id
          ? {
              id: updated.id,
              fullName: updated.fullName,
              companyEmail: updated.companyEmail,
              phone: updated.phone,
              isActive: updated.isActive,
            }
          : item
      )));
      setSuccessMessage(
        `${updated.fullName} is now ${updated.isActive ? "active" : "inactive"}.`,
      );
    } catch (error) {
      if (!(await handleSessionError(error))) {
        setActionError(getManagementErrorMessage(error, "worker"));
      }
    } finally {
      pendingWorkerRefs.current.delete(worker.id);
      setPendingWorkerIds((current) => {
        const next = new Set(current);
        next.delete(worker.id);
        return next;
      });
    }
  };

  const handleGenerateCode = async () => {
    if (generatePendingRef.current) return;
    generatePendingRef.current = true;
    setIsGenerating(true);
    beginAction();
    try {
      const created = await workerService.generateJoinCode();
      const metadata: JoinCode = {
        id: created.id,
        companyId: created.companyId,
        companyName: created.companyName,
        createdByAdminId: created.createdByAdminId,
        createdAt: created.createdAt,
        expiresAt: created.expiresAt,
        status: created.status,
      };
      setJoinCodes((current) => [metadata, ...current]);
      setGeneratedCode(created);
      setSuccessMessage("A single-use join code was generated.");
    } catch (error) {
      if (!(await handleSessionError(error))) {
        setActionError(getManagementErrorMessage(error, "generate"));
      }
    } finally {
      generatePendingRef.current = false;
      setIsGenerating(false);
    }
  };

  const handleRevokeCode = async (joinCode: JoinCode) => {
    if (pendingCodeRefs.current.has(joinCode.id)) return;
    pendingCodeRefs.current.add(joinCode.id);
    setPendingCodeIds((current) => new Set(current).add(joinCode.id));
    beginAction();
    try {
      const revoked = await workerService.revokeJoinCode(joinCode.id);
      setJoinCodes((current) => current.map((item) => (
        item.id === revoked.id ? revoked : item
      )));
      setGeneratedCode((current) => current?.id === revoked.id ? null : current);
      setSuccessMessage("Join code revoked.");
    } catch (error) {
      if (!(await handleSessionError(error))) {
        setActionError(getManagementErrorMessage(error, "revoke"));
      }
    } finally {
      pendingCodeRefs.current.delete(joinCode.id);
      setPendingCodeIds((current) => {
        const next = new Set(current);
        next.delete(joinCode.id);
        return next;
      });
    }
  };

  if (isLoading) {
    return (
      <main className="rm-page role-page" aria-busy="true">
        <p role="status">Loading workers and join codes…</p>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="rm-page role-page">
        <h1>Workers</h1>
        <div className="role-alert" role="alert">{loadError}</div>
        <button className="role-button role-button--secondary" type="button" onClick={() => void loadManagementData()}>
          Retry
        </button>
      </main>
    );
  }

  return (
    <main className="rm-page role-page">
      <header className="role-page__header">
        <p className="role-page__eyebrow">Admin tools</p>
        <h1>Workers</h1>
        <p>Manage workers directly linked to your account and issue single-use join codes.</p>
      </header>

      {actionError && (
        <div ref={actionAlertRef} className="role-alert" role="alert" tabIndex={-1}>
          {actionError}
        </div>
      )}
      <p className="role-status" role="status" aria-live="polite">
        {successMessage ?? ""}
      </p>

      <section className="role-card" aria-labelledby="linked-workers-title">
        <div className="role-section-heading">
          <div>
            <h2 id="linked-workers-title">Linked workers</h2>
            <p>{workers.length} {workers.length === 1 ? "worker" : "workers"}</p>
          </div>
        </div>

        {workers.length === 0 ? (
          <p>No workers are linked to your account yet.</p>
        ) : (
          <ul className="role-list">
            {workers.map((worker) => {
              const isPending = pendingWorkerIds.has(worker.id);
              return (
                <li className="role-list__item" key={worker.id}>
                  <div>
                    <h3>{worker.fullName}</h3>
                    <p>{worker.companyEmail}</p>
                    <p>{worker.phone}</p>
                    <span className={`role-badge role-badge--${worker.isActive ? "active" : "inactive"}`}>
                      {worker.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <button
                    className={`role-button ${worker.isActive ? "role-button--danger" : "role-button--secondary"}`}
                    type="button"
                    disabled={isPending}
                    onClick={() => void handleWorkerStatus(worker)}
                    aria-label={`${worker.isActive ? "Deactivate" : "Activate"} ${worker.fullName}`}
                  >
                    {isPending
                      ? "Updating…"
                      : worker.isActive ? "Deactivate" : "Activate"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="role-card" aria-labelledby="join-codes-title">
        <div className="role-section-heading">
          <div>
            <h2 id="join-codes-title">Worker join codes</h2>
            <p>Codes can be used once and expire automatically.</p>
          </div>
          <button className="role-button role-button--primary" type="button" disabled={isGenerating} onClick={() => void handleGenerateCode()}>
            {isGenerating ? "Generating…" : "Generate join code"}
          </button>
        </div>

        {generatedCode && (
          <div className="role-generated-code" aria-labelledby="generated-code-title">
            <h3 id="generated-code-title">New join code</h3>
            <p className="role-generated-code__value"><code>{generatedCode.code}</code></p>
            <dl className="role-detail-grid">
              <div><dt>Company</dt><dd>{generatedCode.companyName}</dd></div>
              <div><dt>Expires</dt><dd><time dateTime={generatedCode.expiresAt}>{formatDateTime(generatedCode.expiresAt)}</time></dd></div>
              <div><dt>Status</dt><dd>{formatStatus(generatedCode.status)}</dd></div>
            </dl>
            <p className="role-generated-code__notice">Copy this development code now. It is shown only in this page session.</p>
          </div>
        )}

        {joinCodes.length === 0 ? (
          <p>No join codes have been issued.</p>
        ) : (
          <ul className="role-list">
            {joinCodes.map((joinCode) => {
              const isPending = pendingCodeIds.has(joinCode.id);
              return (
                <li className="role-list__item" key={joinCode.id}>
                  <div>
                    <h3>{joinCode.companyName}</h3>
                    <p>Expires <time dateTime={joinCode.expiresAt}>{formatDateTime(joinCode.expiresAt)}</time></p>
                    <span className={`role-badge role-badge--${joinCode.status}`}>
                      {formatStatus(joinCode.status)}
                    </span>
                  </div>
                  {joinCode.status === "active" && (
                    <button
                      className="role-button role-button--danger"
                      type="button"
                      disabled={isPending}
                      onClick={() => void handleRevokeCode(joinCode)}
                      aria-label={`Revoke join code for ${joinCode.companyName} expiring ${formatDateTime(joinCode.expiresAt)}`}
                    >
                      {isPending ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

function formatStatus(status: JoinCode["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getManagementErrorMessage(
  error: unknown,
  action: "load" | "worker" | "generate" | "revoke",
): string {
  if (isServiceError(error)) {
    if (error.code === "network_error") {
      return "We could not reach the service. Check your connection and try again.";
    }
    if (error.code === "forbidden") {
      return "You do not have permission to manage these workers.";
    }
    if (error.code === "validation_error") return error.message;
  }
  const messages = {
    load: "We could not load workers and join codes. Please try again.",
    worker: "We could not update that worker. Please try again.",
    generate: "We could not generate a join code. Please try again.",
    revoke: "We could not revoke that join code. Please try again.",
  } as const;
  return messages[action];
}
