import React from "react";
import Svg, { ClipPath, Defs, Polygon, Rect } from "react-native-svg";

// Simplified state flags drawn in SVG (no emoji exists for US state
// flags). Phase 1 ships Arizona; other states fall back to a label.
export function ArizonaFlag({ width = 34 }: { width?: number }) {
  const height = (width * 2) / 3;
  // Red rays fan from the centre over a gold field; blue lower half;
  // copper star in the centre (official AZ flag elements, simplified).
  const rays = [2, 14, 26, 38, 50].map((x) => `${x},0 ${x + 6},0 30,15`);
  return (
    <Svg width={width} height={height} viewBox="0 0 60 40">
      <Defs>
        <ClipPath id="azclip">
          <Rect x={0} y={0} width={60} height={40} rx={4} />
        </ClipPath>
      </Defs>
      <Rect x={0} y={0} width={60} height={40} fill="#FEC72C" clipPath="url(#azclip)" />
      {rays.map((pts) => (
        <Polygon key={pts} points={pts} fill="#BF0A30" clipPath="url(#azclip)" />
      ))}
      <Rect x={0} y={20} width={60} height={20} fill="#002868" clipPath="url(#azclip)" />
      <Polygon
        points="30,9 32.2,15.2 38.8,15.4 33.6,19.4 35.4,25.8 30,22.2 24.6,25.8 26.4,19.4 21.2,15.4 27.8,15.2"
        fill="#CE5C17"
      />
    </Svg>
  );
}

export function StateFlag({ state, width = 34 }: { state: string; width?: number }) {
  if (state === "AZ") return <ArizonaFlag width={width} />;
  return null;
}
