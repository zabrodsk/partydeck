// Extracted from card-motion 0.2.0, MIT, Francisco Piaggio.
// https://cards.franpiaggio.com — see LICENSE in this directory.
export function fan({ spread = 0.92, maxSpacing = 112, tilt = 5, dip = 4, scale = 1 } = {}) {
  return (index, count, { anchor, width }) => {
    const off = index - (count - 1) / 2;
    const spacingX = count > 1 ? Math.min(maxSpacing, width * spread / count) : 0;
    return {
      x: anchor.x + off * spacingX,
      y: anchor.y + off * off * dip,
      rotation: off * tilt,
      scale
    };
  };
}
