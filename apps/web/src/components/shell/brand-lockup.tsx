import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

type BrandLockupProps = {
  className?: string;
  href?: string;
  onClick?: () => void;
};

export function BrandLockup({ className, href = "/", onClick }: BrandLockupProps) {
  return (
    <Link
      href={href}
      className={cn("pw-brand-lockup", className)}
      onClick={onClick}
    >
      <Image
        src="/ProofWork-Logo-512.png"
        alt=""
        width={28}
        height={28}
        className="size-7 shrink-0 rounded-md"
        priority
      />
      <span className="pw-brand">Proofwork</span>
    </Link>
  );
}
