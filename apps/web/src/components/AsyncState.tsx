interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}

export function LoadingState({ label = "Wird geladen…" }: { label?: string }) {
  return (
    <div className="state-card" role="status">
      <span className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({ error, onRetry, title = "Etwas ist schiefgelaufen" }: ErrorStateProps) {
  const message = error instanceof Error ? error.message : "Ein unerwarteter Fehler ist aufgetreten.";

  return (
    <div className="state-card state-card--error" role="alert">
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      {onRetry ? (
        <button className="button button--secondary" onClick={onRetry} type="button">
          Erneut versuchen
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  description,
  title
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">□</span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
