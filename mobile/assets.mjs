import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { iconPng } from "../desktop/icon.mjs";

/** App icons and splash screens for iOS and Android, drawn from the same mark as the Mac app. */

const here = path.dirname(fileURLToPath(import.meta.url));
const SPLASH_BG = [0xf4, 0xf5, 0xf7];

function write(file, png) {
  const target = path.join(here, file);
  if (!existsSync(path.dirname(target))) return;
  writeFileSync(target, png);
}

// iOS: one opaque, full-bleed 1024 px icon. iOS rounds the corners itself.
write("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", iconPng(1024, { margin: 0, radius: 0, background: [0, 0, 0] }));

// Android: legacy square and round icons, plus the adaptive-icon foreground. The launcher
// masks the foreground to a shape inside its middle 66/108, so the lines are drawn smaller.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [density, scale] of Object.entries(DENSITIES)) {
  const dir = `android/app/src/main/res/mipmap-${density}`;
  write(`${dir}/ic_launcher.png`, iconPng(48 * scale, { margin: 0.04, radius: 0.2 }));
  write(`${dir}/ic_launcher_round.png`, iconPng(48 * scale, { margin: 0.04, radius: 0.5, glyph: 0.56 }));
  write(`${dir}/ic_launcher_foreground.png`, iconPng(108 * scale, { margin: 0, radius: 0, glyph: 0.42 }));
}

// Splash: the tile on the app background, centred. Capacitor scales it to fill the screen.
const splash = iconPng(2732, { margin: (2732 - 360) / 2 / 2732, background: SPLASH_BG });
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  write(`ios/App/App/Assets.xcassets/Splash.imageset/${name}`, splash);
}
for (const [dir, w, h] of [
  ["drawable", 480, 320],
  ["drawable-port-mdpi", 320, 480],
  ["drawable-port-hdpi", 480, 800],
  ["drawable-port-xhdpi", 720, 1280],
  ["drawable-port-xxhdpi", 960, 1600],
  ["drawable-port-xxxhdpi", 1280, 1920],
  ["drawable-land-mdpi", 480, 320],
  ["drawable-land-hdpi", 800, 480],
  ["drawable-land-xhdpi", 1280, 720],
  ["drawable-land-xxhdpi", 1600, 960],
  ["drawable-land-xxxhdpi", 1920, 1280],
]) {
  // The theme stretches this bitmap over the screen, so it keeps the screen's proportions.
  const tile = Math.min(w, h) * 0.22;
  write(`android/app/src/main/res/${dir}/splash.png`, iconPng(w, { margin: (w - tile) / 2 / w, background: SPLASH_BG, height: h }));
}

console.log("[assets] icons and splash screens written");
