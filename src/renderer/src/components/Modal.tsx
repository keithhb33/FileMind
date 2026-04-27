import { X } from "lucide-react";
import type { PropsWithChildren } from "react";
import { IconButton } from "./IconButton";

type ModalProps = PropsWithChildren<{
  open: boolean;
  title: string;
  onClose: () => void;
}>;

export function Modal({ open, title, onClose, children }: ModalProps): JSX.Element | null {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-stone-950/35 px-4">
      <div className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-5 shadow-soft">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
