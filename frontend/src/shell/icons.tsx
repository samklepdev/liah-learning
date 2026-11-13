/**
 * Inline outline icons, drawn to match the 24px stroke style of the reference
 * design. Inline rather than a package so nothing is added to the build.
 */

type IconProps = { className?: string };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

/** Wheel / chassis. */
export function WheelIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v5M12 15.5v5M3.5 12h5M15.5 12h5" />
    </svg>
  );
}

/** Gauge / diagnostics. */
export function GaugeIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3.5 17a9 9 0 1117 0" />
      <path d="M12 17l4-5" />
      <circle cx="12" cy="17" r="1.2" />
    </svg>
  );
}

/** Cog / mechanical. */
export function CogIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v2.4M12 18.6V21M4.2 7.5l2 1.2M17.8 15.3l2 1.2M4.2 16.5l2-1.2M17.8 8.7l2-1.2" />
    </svg>
  );
}

/** Bolt / electrical. */
export function BoltIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M13 3L5.5 13.5H11l-1 7.5L18.5 10H13l.5-7z" />
    </svg>
  );
}

/** Airflow / HVAC. */
export function AirflowIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3.5 8.5h11a3 3 0 100-3" />
      <path d="M3.5 13h8a2.5 2.5 0 110 5" />
      <path d="M3.5 18h4" />
    </svg>
  );
}

/** Clipboard / servicing. */
export function ClipboardIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M9 4.5h6v2H9z" />
      <path d="M7.5 5.5H6A1.5 1.5 0 004.5 7v12A1.5 1.5 0 006 20.5h12a1.5 1.5 0 001.5-1.5V7A1.5 1.5 0 0018 5.5h-1.5" />
      <path d="M8.5 11h7M8.5 14.5h7" />
    </svg>
  );
}

/** Steering wheel / drivers assist. */
export function SteeringIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 14.2V20.5M9.9 11.2L3.8 9.6M14.1 11.2l6.1-1.6" />
    </svg>
  );
}

export function BookIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4.5 5.5A1.5 1.5 0 016 4h13v16H6a1.5 1.5 0 01-1.5-1.5z" />
      <path d="M9 4v16" />
    </svg>
  );
}

/** Bar chart / progress. */
export function ChartIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4.5 19.5h15" />
      <path d="M7 19.5v-6M12 19.5v-10M17 19.5v-4" />
    </svg>
  );
}

export function VideoIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4.5 6.5h15v11h-15z" />
      <path d="M19.5 8.5l3-2v10l-3-2" />
    </svg>
  );
}

export function SunIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M5.2 18.8l1.4-1.4M17.4 6.6l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />
    </svg>
  );
}

/** Half-filled circle: follow the operating system. */
export function AutoThemeIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17a8.5 8.5 0 000-17z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function UserIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 19.5a7 7 0 0114 0" />
    </svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 7h14" />
      <path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
      <path d="M7 7l1 13a1 1 0 001 1h6a1 1 0 001-1l1-13" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/** A person with a minus sign: demoting an admin back to a plain user. */
export function UserMinusIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="10" cy="8" r="3.2" />
      <path d="M3.5 19.5a6.8 6.8 0 0113 0" />
      <path d="M16.5 12.5h5" />
    </svg>
  );
}

export function SignOutIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M9 4.5H6A1.5 1.5 0 004.5 6v12A1.5 1.5 0 006 19.5h3" />
      <path d="M14 15l4.5-3-4.5-3" />
      <path d="M18.5 12h-10" />
    </svg>
  );
}

/** Circular arrow: restoring a soft-deleted row. */
export function RestoreIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4.5 12a7.5 7.5 0 1113-5.5" />
      <path d="M4.5 4.5v5h5" />
    </svg>
  );
}

/** A key: resetting a password. */
export function KeyIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="8" cy="15" r="3.2" />
      <path d="M10.3 12.7L19 4" />
      <path d="M15.5 8.5l2.5 2.5M18 6l2.5 2.5" />
    </svg>
  );
}

const BY_SLUG: Record<string, (p: IconProps) => React.ReactElement> = {
  chassis: WheelIcon,
  diagnostics: GaugeIcon,
  'drive-train': CogIcon,
  'drivers-assist': SteeringIcon,
  electrical: BoltIcon,
  engine: CogIcon,
  hvac: AirflowIcon,
  servicing: ClipboardIcon,
};

/**
 * A component rather than a factory returning one: selecting the icon inside a
 * parent's render would be creating a component during render, which breaks
 * both Fast Refresh and React's component identity.
 */
export function SubjectIcon({ slug, className }: { slug: string } & IconProps) {
  const Icon = BY_SLUG[slug] ?? BookIcon;
  return <Icon className={className} />;
}
