import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Clarity Mail",
    short_name: "Clarity",
    description: "Every inbox, one brief. The same copy on your phone and Mac.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f5f7",
    theme_color: "#f4f5f7",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
