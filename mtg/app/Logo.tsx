/**
 * The Inkfall seal (public/inkfall-seal.svg): a blot of sealing wax pressed with an ink drop and a nib slit.
 * `size` is in pixels. `glow` is kept so old call sites still work: the seal casts a hard shadow now, never a glow.
 */
export default function Logo({ size = 40, className = "", glow = false }: { size?: number; className?: string; glow?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/inkfall-seal.svg"
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={`shrink-0 select-none object-contain ${className}`}
      style={{ width: size, height: size, filter: glow ? "drop-shadow(4px 6px 0 rgba(8,5,3,.6))" : "drop-shadow(2px 3px 0 rgba(8,5,3,.55))", transform: "rotate(-4deg)" }}
    />
  );
}
