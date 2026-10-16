import { logoImage } from "@/lib/logo-image";

export function generateImageMetadata() {
  return [32, 192, 512].map((px) => ({
    id: String(px),
    contentType: "image/png",
    size: { width: px, height: px },
  }));
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const px = Number(await id);
  return logoImage(px, { padded: px >= 192 });
}
