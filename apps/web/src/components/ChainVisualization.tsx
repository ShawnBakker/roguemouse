function truncate(hex: string): string {
  return hex.length <= 12 ? hex : `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}

export function GenesisBanner({
  previousHash,
  genesisHash,
}: {
  previousHash: string;
  genesisHash: string;
}) {
  const isGenesis = previousHash === genesisHash;
  return (
    <div
      className="flex flex-wrap items-center gap-3 p-3 border"
      style={{
        backgroundColor: isGenesis ? "var(--color-positive-dim)" : "var(--color-faint)",
        borderColor: isGenesis ? "var(--color-positive-border)" : "var(--color-rule)",
      }}
    >
      <span
        className="text-label px-2 py-0.5 border"
        style={{
          backgroundColor: "var(--color-surface)",
          borderColor: isGenesis ? "var(--color-positive-border)" : "var(--color-rule)",
          color: isGenesis ? "var(--color-positive)" : "var(--color-muted)",
        }}
      >
        {isGenesis ? "Genesis" : "Chain head"}
      </span>
      <span className="mono text-caption" style={{ color: "var(--color-muted)" }}>
        previousHash {truncate(previousHash)}
        {isGenesis ? " · sha256(\"roguemouse-audit-genesis-v1\")" : null}
      </span>
    </div>
  );
}

export function ChainLink({ hash }: { hash: string }) {
  return (
    <div
      className="flex items-center gap-2 pl-4 -my-1"
      aria-hidden
    >
      <span
        className="mono text-caption"
        style={{ color: "var(--color-rule)" }}
      >
        │
      </span>
      <span
        className="mono text-caption"
        style={{ color: "var(--color-muted)" }}
      >
        ↓ {truncate(hash)}
      </span>
    </div>
  );
}
