/**
 * ONEBIZ Logo Components
 *
 * Usage:
 *   <LogoIcon />                  → icon "O." vuông (cho top-nav compact slot)
 *   <LogoWordmark />              → wordmark "ONEBIZ." (cho login page, footer)
 *   <LogoWordmark variant="white" /> → trắng cho dark background
 *
 * Brand tokens (match INTEGRATION_GUIDE):
 *   navy    #1E3A8A   (main)
 *   blue    #2563EB   (period accent)
 *   blue-light #60A5FA (period on dark bg)
 *
 * Dùng inline SVG để zero HTTP request cho above-the-fold render.
 */

import Image from "next/image";
import { cn } from "@/lib/utils";

// ── Aspect ratio (từ viewBox) ──
const WORDMARK_ASPECT = 268.02 / 48; // ≈ 5.58

// ---------------------------------------------------------------------------
// LogoIcon — icon "O." vuông, dùng cho top-nav slot compact (h-9 w-9).
// Inline SVG để không phải chờ HTTP request.
// ---------------------------------------------------------------------------

interface LogoIconProps {
  size?: number;
  className?: string;
}

export function LogoIcon({ size = 36, className }: LogoIconProps) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="ONEBIZ"
    >
      <rect width="512" height="512" rx="96" fill="#1E3A8A" />
      {/* Glyph "O" */}
      <path
        d="M1507 711Q1507 491 1420.0 324.0Q1333 157 1171.0 68.5Q1009 -20 793 -20Q461 -20 272.5 175.5Q84 371 84 711Q84 1050 272.0 1240.0Q460 1430 795 1430Q1130 1430 1318.5 1238.0Q1507 1046 1507 711ZM1206 711Q1206 939 1098.0 1068.5Q990 1198 795 1198Q597 1198 489.0 1069.5Q381 941 381 711Q381 479 491.5 345.5Q602 212 793 212Q991 212 1098.5 342.0Q1206 472 1206 711Z"
        transform="translate(65.816 389.120) scale(0.18896 -0.18896)"
        fill="#FFFFFF"
      />
      {/* Period accent (xanh nhạt hơn chút để contrast tốt trên navy) */}
      <circle cx="410.344" cy="353.280" r="35.840" fill="#60A5FA" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// LogoWordmark — chữ "ONEBIZ." ngang. Dùng cho login page, footer, header
// rộng rãi. Inline SVG, currentColor để theme được (dark mode friendly).
// ---------------------------------------------------------------------------

interface LogoWordmarkProps {
  /** Chiều cao target, px. Mặc định 24. */
  height?: number;
  /** white = cho dark bg; default = navy cho light bg */
  variant?: "default" | "white";
  className?: string;
  /** Override màu chấm period (xanh). Default: brand blue #2563EB */
  periodColor?: string;
}

export function LogoWordmark({
  height = 24,
  variant = "default",
  className,
  periodColor,
}: LogoWordmarkProps) {
  const width = Math.round(height * WORDMARK_ASPECT);
  const textColor = variant === "white" ? "#FFFFFF" : "#1E3A8A";
  const period = periodColor ?? (variant === "white" ? "#60A5FA" : "#2563EB");

  return (
    <svg
      viewBox="-11.40 -4.00 268.02 48.00"
      width={width}
      height={height}
      className={cn("shrink-0", className)}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="ONEBIZ"
    >
      <g fill={textColor}>
        <path d="M1507 711Q1507 491 1420.0 324.0Q1333 157 1171.0 68.5Q1009 -20 793 -20Q461 -20 272.5 175.5Q84 371 84 711Q84 1050 272.0 1240.0Q460 1430 795 1430Q1130 1430 1318.5 1238.0Q1507 1046 1507 711ZM1206 711Q1206 939 1098.0 1068.5Q990 1198 795 1198Q597 1198 489.0 1069.5Q381 941 381 711Q381 479 491.5 345.5Q602 212 793 212Q991 212 1098.5 342.0Q1206 472 1206 711Z" transform="translate(0.000 40.000) scale(0.02839 -0.02839)" />
        <path d="M995 0 381 1085Q399 927 399 831V0H137V1409H474L1097 315Q1079 466 1079 590V1409H1341V0Z" transform="translate(48.630 40.000) scale(0.02839 -0.02839)" />
        <path d="M137 0V1409H1245V1181H432V827H1184V599H432V228H1286V0Z" transform="translate(94.024 40.000) scale(0.02839 -0.02839)" />
        <path d="M1386 402Q1386 210 1242.0 105.0Q1098 0 842 0H137V1409H782Q1040 1409 1172.5 1319.5Q1305 1230 1305 1055Q1305 935 1238.5 852.5Q1172 770 1036 741Q1207 721 1296.5 633.5Q1386 546 1386 402ZM1008 1015Q1008 1110 947.5 1150.0Q887 1190 768 1190H432V841H770Q895 841 951.5 884.5Q1008 928 1008 1015ZM1090 425Q1090 623 806 623H432V219H817Q959 219 1024.5 270.5Q1090 322 1090 425Z" transform="translate(136.210 40.000) scale(0.02839 -0.02839)" />
        <path d="M137 0V1409H432V0Z" transform="translate(181.604 40.000) scale(0.02839 -0.02839)" />
        <path d="M1192 0H61V209L823 1178H137V1409H1151V1204L389 231H1192Z" transform="translate(201.164 40.000) scale(0.02839 -0.02839)" />
      </g>
      <circle cx="241.422" cy="36.200" r="3.800" fill={period} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// LogoImage — fallback dùng file SVG qua next/image (nếu muốn optimize)
// Dùng khi cần Image component features (lazy, priority, responsive sizes).
// ---------------------------------------------------------------------------

interface LogoImageProps {
  variant?: "default" | "white" | "mono";
  width?: number;
  className?: string;
}

export function LogoImage({
  variant = "default",
  width = 140,
  className,
}: LogoImageProps) {
  const src =
    variant === "white"
      ? "/brand/wordmark-white.svg"
      : variant === "mono"
        ? "/brand/wordmark-mono.svg"
        : "/brand/wordmark.svg";
  const height = Math.round(width / WORDMARK_ASPECT);

  return (
    <Image
      src={src}
      alt="ONEBIZ"
      width={width}
      height={height}
      className={className}
      priority
    />
  );
}
