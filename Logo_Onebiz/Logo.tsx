/**
 * ONEBIZ Logo Components
 *
 * Drop into: components/brand/Logo.tsx
 * Usage:
 *   <Logo />                     → default navy wordmark
 *   <Logo variant="white" />     → white wordmark for dark bg
 *   <Logo width={200} />         → custom width
 *   <LogoInline />               → inline SVG, no HTTP request
 *
 * Requires SVG files in /public/brand/:
 *   - wordmark.svg
 *   - wordmark-white.svg
 */

import Image from 'next/image'

interface LogoProps {
  variant?: 'default' | 'white'
  width?: number
  className?: string
}

// Aspect ratio of viewBox: 268.02 / 48 ≈ 5.58
const ASPECT_RATIO = 5.58

export function Logo({ variant = 'default', width = 140, className }: LogoProps) {
  const src =
    variant === 'white' ? '/brand/wordmark-white.svg' : '/brand/wordmark.svg'
  const height = Math.round(width / ASPECT_RATIO)

  return (
    <Image
      src={src}
      alt="ONEBIZ"
      width={width}
      height={height}
      className={className}
      priority
    />
  )
}

/**
 * Inline variant — zero HTTP request, ideal for sidebar/header above the fold.
 * Uses currentColor so you can control color via CSS/Tailwind.
 *
 * Example:
 *   <LogoInline className="h-6 text-[#1E3A8A]" />
 *   <LogoInline className="h-6 text-white" /> on dark bg
 */
export function LogoInline({
  className = 'h-6',
  periodColor,
}: {
  className?: string
  /** Override period accent color. Defaults to brand blue #2563EB (or light blue on dark). */
  periodColor?: string
}) {
  const period = periodColor ?? '#2563EB'

  return (
    <svg
      viewBox="-11.40 -4.00 268.02 48.00"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="ONEBIZ"
    >
      <g fill="currentColor">
        <path d="M1507 711Q1507 491 1420.0 324.0Q1333 157 1171.0 68.5Q1009 -20 793 -20Q461 -20 272.5 175.5Q84 371 84 711Q84 1050 272.0 1240.0Q460 1430 795 1430Q1130 1430 1318.5 1238.0Q1507 1046 1507 711ZM1206 711Q1206 939 1098.0 1068.5Q990 1198 795 1198Q597 1198 489.0 1069.5Q381 941 381 711Q381 479 491.5 345.5Q602 212 793 212Q991 212 1098.5 342.0Q1206 472 1206 711Z" transform="translate(0.000 40.000) scale(0.02839 -0.02839)"/>
        <path d="M995 0 381 1085Q399 927 399 831V0H137V1409H474L1097 315Q1079 466 1079 590V1409H1341V0Z" transform="translate(48.630 40.000) scale(0.02839 -0.02839)"/>
        <path d="M137 0V1409H1245V1181H432V827H1184V599H432V228H1286V0Z" transform="translate(94.024 40.000) scale(0.02839 -0.02839)"/>
        <path d="M1386 402Q1386 210 1242.0 105.0Q1098 0 842 0H137V1409H782Q1040 1409 1172.5 1319.5Q1305 1230 1305 1055Q1305 935 1238.5 852.5Q1172 770 1036 741Q1207 721 1296.5 633.5Q1386 546 1386 402ZM1008 1015Q1008 1110 947.5 1150.0Q887 1190 768 1190H432V841H770Q895 841 951.5 884.5Q1008 928 1008 1015ZM1090 425Q1090 623 806 623H432V219H817Q959 219 1024.5 270.5Q1090 322 1090 425Z" transform="translate(136.210 40.000) scale(0.02839 -0.02839)"/>
        <path d="M137 0V1409H432V0Z" transform="translate(181.604 40.000) scale(0.02839 -0.02839)"/>
        <path d="M1192 0H61V209L823 1178H137V1409H1151V1204L389 231H1192Z" transform="translate(201.164 40.000) scale(0.02839 -0.02839)"/>
      </g>
      <circle cx="241.422" cy="36.200" r="3.800" fill={period}/>
    </svg>
  )
}
