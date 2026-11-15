import { useId } from "react";

export function Logo({ className = "size-9" }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 512 512" className={className} role="img" aria-label="Tethera logo">
      <defs>
        <linearGradient id={`${uid}-bg`} x1="40" y1="20" x2="480" y2="500" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#22D3EE" />
          <stop offset="0.5" stopColor="#3B82F6" />
          <stop offset="1" stopColor="#6366F1" />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx="30%" cy="12%" r="70%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="512" height="512" rx="120" fill={`url(#${uid}-bg)`} />
      <rect width="512" height="512" rx="120" fill={`url(#${uid}-glow)`} />
      <g fill="none" stroke="#fff" strokeLinecap="round">
        <circle cx="170" cy="172" r="52" strokeWidth="26" />
        <path d="M212 212 C 290 236, 226 306, 304 332" strokeWidth="26" />
      </g>
      <circle cx="346" cy="344" r="56" fill="#fff" />
    </svg>
  );
}
