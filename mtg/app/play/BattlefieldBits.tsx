import type { PlayerId } from "@mtg/engine";

// The small hand-drawn pieces of a battlefield: the owner's wax seal, the ink rule with its flourishes, and the three zone icons.
// All drawn in one ink-line style; colours come from the --bf-* tokens in battlefield.css.

/** A little blot of sealing wax in the owner's colour (moss for the near side, wax red for the far side), pressed with a mark. */
export function Seal({ player }: { player: PlayerId }) {
  return (
    <svg className="bf-seal" viewBox="0 0 24 24" aria-hidden="true">
      <path
        className="wax"
        d={player === "p2" ? "M12 2.3c2.6.1 3.4 1.5 5.4 1.9 2 .5 3.1 1.8 3.5 3.6.3 1.6 1.8 2.6 1.4 4.5-.4 1.9-1.4 3-1.8 4.6-.5 1.8-1.6 3.2-3.6 4.1-1.8.8-2.9 2.3-5.2 2-2.2-.2-3.3-1.5-4.9-2.3-1.9-.9-3-2.2-3.3-4-.3-1.7-1.9-2.8-1.4-4.7.4-1.800 1.600-2.700 2.100-4.300.5-1.900 1.800-3.100 3.700-3.500C9 3.700 9.500 2.200 12 2.300z" : "M12 2.1c2.4 0 3.500 1.300 5.200 1.800 2 .6 3.100 1.600 3.600 3.500.4 1.500 1.900 2.600 1.500 4.400-.4 1.900-1.200 3.100-1.700 4.700-.5 1.800-1.700 3.300-3.700 4.200-1.700.7-2.800 2-5.100 1.900-2.300-.1-3.300-1.400-5-2.100-1.800-.8-3-2.200-3.400-4-.3-1.600-1.700-2.700-1.300-4.600.4-1.800 1.800-2.800 2.200-4.400.5-1.900 1.700-3.100 3.600-3.600C8.900 3.600 9.600 2.100 12 2.100z"}
      />
      <circle className="ring" cx="12" cy="12.2" r="6.4" />
      {player === "p2" ? <path className="mark" d="M12 8.2c1.700 2.100 3 3.500 3 5a3 3 0 0 1-6 0c0-1.500 1.300-2.900 3-5z" /> : <path className="mark" d="M8.500 15.200c3.500-.2 5.800-3 6.300-6.600-3.300.4-5.900 2.300-6.300 6.600zM8.400 15.300l4-4.300" />}
    </svg>
  );
}

/**
 * The rule between a player's lands and creatures: an uneven ink stroke with a stitched line beside it and a curl at each end.
 * It is clear on light and dark mats (a dark under-stroke, a cream ink stroke).
 */
export function InkRule({ draw, seed = 1 }: { draw: boolean; seed?: number }) {
  // a slightly different wobble for each side of the table, the same every time
  const a = seed % 2 ? [3.4, 6.8, 4.6, 6.2] : [6.2, 3.6, 6.6, 4.4];
  const wobble = `M0 6 C 30 ${a[0]}, 70 ${a[1]}, 120 6 S 190 ${a[2]}, 250 6 S 330 ${a[3]}, 400 6`;
  return (
    <div className="bf-rule" role="presentation" data-draw={draw ? "on" : "off"}>
      <svg className="ends" viewBox="0 0 22 12" aria-hidden="true">
        <path className="shade" d="M20 6c-3.400 0-4.600-3.600-8-3.600S6 6 9.500 6 12 9.200 6 8.800" />
        <path className="ink" pathLength={1} d="M20 6c-3.400 0-4.600-3.600-8-3.600S6 6 9.500 6 12 9.200 6 8.800" />
      </svg>
      <svg className="line" viewBox="0 0 400 12" preserveAspectRatio="none" aria-hidden="true">
        <path className="shade" pathLength={1} d={wobble} />
        <path className="ink" pathLength={1} d={wobble} />
        <path className="stitch" d="M0 10.500 C 90 9.600, 210 11.400, 400 10.400" />
      </svg>
      <svg className="ends" viewBox="0 0 22 12" aria-hidden="true" style={{ transform: "scaleX(-1)" }}>
        <path className="shade" d="M20 6c-3.400 0-4.600-3.600-8-3.600S6 6 9.500 6 12 9.200 6 8.800" />
        <path className="ink" pathLength={1} d="M20 6c-3.400 0-4.600-3.600-8-3.600S6 6 9.500 6 12 9.200 6 8.800" />
      </svg>
    </div>
  );
}

const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Library: a card slid into a pocket. Graveyard: a headstone. Exile: a wisp that is leaving. */
export function ZoneIcon({ kind }: { kind: "library" | "graveyard" | "exile" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="ink-icon">
      {kind === "library" ? (
        <>
          <path {...line} d="M7.500 3.600c3-.4 6.200-.3 9 0v11.800H7.500z" />
          <path {...line} d="M4.600 11.200h14.800v8.300a1.200 1.200 0 0 1-1.200 1.200H5.800a1.200 1.200 0 0 1-1.200-1.200z" />
        </>
      ) : kind === "graveyard" ? (
        <>
          <path {...line} d="M6.800 20.400V9.800a5.200 5.200 0 0 1 10.400 0v10.600z" />
          <path {...line} d="M12 8.600v5M9.800 10.800h4.400" />
          <path {...line} d="M4.200 20.500h15.600" opacity=".6" />
        </>
      ) : (
        <>
          <path {...line} d="M12.200 3.400c3.600 2.400 4.800 5.400 3 8.200-1.300 2-.2 3.400 1.700 4.300" />
          <path {...line} d="M10.600 8c-3 1.800-4 4.200-2.600 6.700 1 1.800 3.600 2.800 6 2.200" opacity=".6" />
          <path {...line} d="M8 20.400c2.600.6 5.200.6 8 0" opacity=".45" />
        </>
      )}
    </svg>
  );
}
