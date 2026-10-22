"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { useStore } from "@/lib/store";

type Listener = { remove: () => Promise<void> | void };

/** The part of the Capacitor bridge Clarity uses. The iPhone and Android apps inject it. */
type CapacitorBridge = {
  isNativePlatform: () => boolean;
  getPlatform: () => "ios" | "android" | "web";
  Plugins: {
    App?: {
      addListener: (event: "backButton", fn: (e: { canGoBack: boolean }) => void) => Promise<Listener>;
      minimizeApp: () => Promise<void>;
    };
    StatusBar?: { setStyle: (options: { style: "DARK" | "LIGHT" }) => Promise<void> };
  };
};

declare global {
  interface Window {
    /** Set by the iPhone and Android apps; absent in a browser. */
    Capacitor?: CapacitorBridge;
  }
}

function nativeApp() {
  const cap = typeof window === "undefined" ? undefined : window.Capacitor;
  return cap?.isNativePlatform() ? cap : null;
}

/**
 * iPhone and Android app extras: the status bar follows the theme, and Android's
 * back button closes the open conversation before it leaves the page.
 */
export function NativeBridge() {
  const { selectedId, select } = useStore();
  const { resolvedTheme } = useTheme();
  const open = useRef(selectedId);

  useEffect(() => {
    open.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const cap = nativeApp();
    if (!cap) return;
    document.documentElement.classList.add("native-app", `native-${cap.getPlatform()}`);
  }, []);

  useEffect(() => {
    // "DARK" is the style for a dark background: light text.
    void nativeApp()?.Plugins.StatusBar?.setStyle({ style: resolvedTheme === "dark" ? "DARK" : "LIGHT" }).catch(
      () => undefined,
    );
  }, [resolvedTheme]);

  useEffect(() => {
    const app = nativeApp()?.Plugins.App;
    if (!app) return;
    let listener: Listener | null = null;
    let live = true;
    void app
      .addListener("backButton", ({ canGoBack }) => {
        if (open.current) select(null);
        else if (canGoBack) window.history.back();
        else void app.minimizeApp();
      })
      .then((l) => {
        if (live) listener = l;
        else void l.remove();
      });
    return () => {
      live = false;
      void listener?.remove();
    };
  }, [select]);

  return null;
}
