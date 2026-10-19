import { ImageResponse } from "next/og";

/** Favicon / touch icon: the Clarity mark (three white lines on a blue gradient tile). */
export function logoImage(size: number, { padded = false } = {}) {
  const unit = (size * 0.62) / 32;
  const origin = size * 0.19;
  const stroke = 3.2 * unit;
  const bars: [number, number, number][] = [
    [10.5, 6, 26],
    [16, 6, 19],
    [21.5, 6, 13.5],
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "linear-gradient(145deg, #5b9bff, #2745b8)",
          borderRadius: padded ? 0 : size * 0.225,
          position: "relative",
        }}
      >
        {bars.map(([cy, x1, x2]) => (
          <div
            key={cy}
            style={{
              position: "absolute",
              left: origin + x1 * unit - stroke / 2,
              top: origin + cy * unit - stroke / 2,
              width: (x2 - x1) * unit + stroke,
              height: stroke,
              borderRadius: stroke,
              background: "#ffffff",
            }}
          />
        ))}
      </div>
    ),
    { width: size, height: size },
  );
}
