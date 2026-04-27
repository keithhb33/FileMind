import type { PropsWithChildren } from "react";

type IconButtonProps = PropsWithChildren<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
}>;

export function IconButton({ label, onClick, disabled, children }: IconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-9 w-9 place-items-center rounded-md border border-stone-200 bg-white text-stone-700 transition hover:border-emerald-800 hover:text-emerald-950 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
