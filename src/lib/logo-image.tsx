import { ImageResponse } from "next/og";

export function logoImage(size: number, { padded = false } = {}) {
  const stroke = Math.round(size * 0.09);
  const inset = padded ? size * 0.22 : size * 0.2;
  const lines = [0.32, 0.5, 0.68];
  const widths = [1, 0.62, 0.36];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#f7f6f3",
          borderRadius: padded ? 0 : size * 0.22,
          position: "relative",
        }}
      >
        {lines.map((y, i) => (
          <div
            key={y}
            style={{
              position: "absolute",
              left: inset,
              top: size * y - stroke / 2,
              width: (size - inset * 2) * widths[i],
              height: stroke,
              borderRadius: stroke,
              background: "#2c2824",
            }}
          />
        ))}
      </div>
    ),
    { width: size, height: size },
  );
}
