/**
 * The Scribe's mark: a blot of sealing wax pressed with a quill and a drop of ink (the same wax as the Inkfall seal, so the helper
 * belongs to the book). `size` is in pixels.
 */
export default function ScribeMark({ size = 44, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="The Scribe" className={className}>
      <defs>
        <radialGradient id="scribe-wax" cx="35%" cy="28%" r="80%">
          <stop offset="0" stopColor="#e9755b" />
          <stop offset="0.55" stopColor="#b5382a" />
          <stop offset="1" stopColor="#74201a" />
        </radialGradient>
        <linearGradient id="scribe-feather" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff6dc" />
          <stop offset="1" stopColor="#e8d3a0" />
        </linearGradient>
      </defs>
      {/* the wax: an uneven blot with a pressed rim */}
      <path
        d="M32 3.5c8.6-.9 14.6 2.6 20 8.2 5.5 5.6 9 12.6 8.3 21.2-.7 9.6-4.8 16.8-11.6 22.2-6.4 5-14.4 6.6-22.1 5.3C19.6 59.1 12.4 54.6 8 47.5 3.3 40 2.4 31.6 5.2 23.6 8.2 15.1 14.8 8 23.6 5c2.8-.9 5.5-1.3 8.4-1.5Z"
        fill="url(#scribe-wax)"
      />
      <circle cx="32" cy="33" r="22.5" fill="none" stroke="#ffe3a6" strokeOpacity="0.45" strokeWidth="1.4" strokeDasharray="2.2 3.4" />
      {/* the quill, pointing down and to the left */}
      <path d="M46 13c-10.5 1.8-21 11.6-24.4 25.6L19.8 47l5.3-4.2C37.6 40.6 45.2 30.6 46 13Z" fill="url(#scribe-feather)" stroke="#5b1912" strokeOpacity="0.35" strokeWidth="0.8" />
      <path d="M46 13 19.8 47" stroke="#8f2b1f" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M40.5 21.5l-8 1M37 27.5l-8.5 1.5M33.5 33.5l-7 2.6" stroke="#8f2b1f" strokeOpacity="0.55" strokeWidth="1" strokeLinecap="round" fill="none" />
      {/* the ink drop at the nib */}
      <path d="M15.2 52.2c0-3.2 3.2-6.4 3.2-6.4s3.2 3.2 3.2 6.4a3.2 3.2 0 0 1-6.4 0Z" fill="#241913" />
      <ellipse cx="17" cy="51.2" rx="0.9" ry="1.3" fill="#fff" fillOpacity="0.35" />
    </svg>
  );
}
