import { logoImage } from "@/lib/logo-image";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return logoImage(180, { padded: true });
}
