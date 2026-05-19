"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { isVariant, type Variant } from "@/lib/canonicalRuns";

export function VariantToggle({ defaultVariant }: { defaultVariant: Variant }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const raw = params.get("variant");
  const current: Variant = isVariant(raw) ? raw : defaultVariant;

  function setVariant(next: Variant) {
    if (next === current) return;
    const sp = new URLSearchParams(params.toString());
    if (next === "clean") sp.delete("variant");
    else sp.set("variant", next);
    const qs = sp.toString();
    startTransition(() => {
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    });
  }

  const baseBtn =
    "px-3 py-1.5 text-small border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const activeStyle = {
    backgroundColor: "var(--color-ink)",
    color: "var(--color-bg)",
    borderColor: "var(--color-ink)",
  } as const;
  const inactiveStyle = {
    backgroundColor: "var(--color-surface)",
    color: "var(--color-ink)",
    borderColor: "var(--color-rule)",
  } as const;

  return (
    <div className="inline-flex gap-0" role="group" aria-label="scenario variant">
      <button
        type="button"
        onClick={() => setVariant("clean")}
        className={baseBtn}
        style={current === "clean" ? activeStyle : inactiveStyle}
        aria-pressed={current === "clean"}
        disabled={pending}
      >
        Clean
      </button>
      <button
        type="button"
        onClick={() => setVariant("degraded")}
        className={baseBtn}
        style={
          current === "degraded"
            ? activeStyle
            : { ...inactiveStyle, borderLeft: "none" }
        }
        aria-pressed={current === "degraded"}
        disabled={pending}
      >
        Degraded
      </button>
    </div>
  );
}
