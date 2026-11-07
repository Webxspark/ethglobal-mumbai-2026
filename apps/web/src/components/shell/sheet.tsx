"use client";

import { Button, Drawer } from "@heroui/react";
import { cn } from "@/lib/utils";

/**
 * Controlled bottom drawer (HeroUI v3 Drawer) — no drag handle.
 * Prefer AppModal for desktop fund / form dialogs.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  tone = "default",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  tone?: "default" | "world" | "tee";
}) {
  return (
    <Drawer
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Button className="sr-only" aria-hidden>
        Open
      </Button>
      <Drawer.Backdrop isDismissable variant="opaque">
        <Drawer.Content placement="bottom" className="max-h-[92dvh]">
          <Drawer.Dialog
            className={cn(
              "mx-auto w-full max-w-md rounded-t-[6px]",
              tone === "world" && "border-t-2 border-t-[#2f6feb]",
            )}
          >
            <Drawer.Header className="px-4 pb-1 pt-4">
              <Drawer.Heading className="text-[15px] font-semibold tracking-tight">
                {title}
              </Drawer.Heading>
              <Drawer.CloseTrigger />
            </Drawer.Header>
            <Drawer.Body className="px-4 pb-5">{children}</Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
