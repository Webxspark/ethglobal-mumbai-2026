"use client";

import { Modal } from "@heroui/react";
import { cn } from "@/lib/utils";

/** Controlled HeroUI Modal — no drawer handle, desktop-first. */
export function AppModal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <Modal.Backdrop
      isOpen={open}
      isDismissable
      variant="opaque"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Modal.Container size={size} placement="center" scroll="inside">
        <Modal.Dialog
          className={cn("rounded-[6px] sm:max-w-[420px]", className)}
        >
          <Modal.CloseTrigger />
          <Modal.Header className="px-4 pb-1 pt-4">
            <Modal.Heading className="text-[15px] font-semibold tracking-tight">
              {title}
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body className="gap-4 px-4 pb-2">{children}</Modal.Body>
          {footer ? (
            <Modal.Footer className="flex flex-col-reverse gap-2 px-4 pb-4 pt-3 sm:flex-row sm:items-center sm:justify-end">
              {footer}
            </Modal.Footer>
          ) : null}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
