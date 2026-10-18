import Image from "next/image";

export function BrandLogo({
  variant = "full",
  tone = "dark",
  priority = false,
}: {
  variant?: "full" | "compact" | "icon";
  tone?: "dark" | "light";
  priority?: boolean;
}) {
  const icon = variant === "icon";
  return (
    <Image
      className={`brand-logo brand-logo--${variant}`}
      src={icon ? "/brand/cinevjet-icon.svg" : `/brand/cinevjet-logo-${tone}.svg`}
      width={icon ? 224 : 740}
      height={icon ? 224 : 215}
      alt="CineVjet"
      priority={priority}
    />
  );
}
