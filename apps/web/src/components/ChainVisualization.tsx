import { GENESIS_HASH } from "@roguemouse/audit";

function truncate(hex: string): string {
  return hex.length <= 12 ? hex : `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}

export function GenesisBanner({ previousHash }: { previousHash: string }) {
  const isGenesis = previousHash === GENESIS_HASH;
  return (
    <div
      className="p-3 border flex flex-wrap items-center gap-3"
      style={{
        backgroundColor: isGenesis ? "var(--color-positive-dim)" : "var(--color-faint)",
        borderColor: isGenesis ? "var(--color-positive-border)" : "var(--color-rule)",
      }}
    >
      <span className="text-label">{isGenesis ? "chain root" : "chain head"}</span>
      <span
        className="mono text-caption"
        style={{ color: "var(--color-muted)" }}
      >
        previousHash {truncate(previousHash)}
        {isGenesis ? " (genesis)" : null}
      </span>
    </div>
  );
}

export function ChainLink({ hash }: { hash: string }) {
  return (
    <div className="flex items-center justify-center py-1" aria-hidden>
      <span
        className="mono text-caption"
        style={{ color: "var(--color-rule)" }}
      >
        ▼
      </span>
    </div>
  );
}
