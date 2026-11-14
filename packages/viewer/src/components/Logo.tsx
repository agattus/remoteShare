import { useId } from "react";

export function Logo({ className = "size-9" }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 512 512" className={className} role="img" aria-label="Orbit logo">
      <defs>
        <linearGradient id={`${uid}-bg`} x1="40" y1="20" x2="480" y2="500" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5B8CFF" />
          <stop offset="0.55" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#EC4899" />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx="30%" cy="12%" r="70%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.38" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-planet`} x1="200" y1="190" x2="310" y2="330" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dfe3ff" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="120" fill={`url(#${uid}-bg)`} />
      <rect width="512" height="512" rx="120" fill={`url(#${uid}-glow)`} />
      <g transform="rotate(-25 256 256)" fill="none" strokeLinecap="round">
        <path d="M96 256 A160 60 0 0 1 416 256" stroke="#fff" strokeOpacity="0.55" strokeWidth="20" />
        <circle cx="256" cy="256" r="74" fill={`url(#${uid}-planet)`} stroke="none" />
        <path d="M416 256 A160 60 0 0 1 96 256" stroke="#fff" strokeWidth="20" />
        <circle cx="396" cy="226" r="22" fill="#fff" stroke="none" />
      </g>
    </svg>
  );
}
