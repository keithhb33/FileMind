import type { PropsWithChildren } from "react";

type Tone = "neutral" | "success" | "warning";

const tones: Record<Tone, string> = {
  neutral: "border-stone-200 bg-white text-stone-600",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900"
};

export function Pill({ tone = "neutral", children }: PropsWithChildren<{ tone?: Tone }>): JSX.Element {
  return <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
