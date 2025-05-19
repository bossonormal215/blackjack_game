"use client";
import { useEffect } from "react";
import { sdk } from "@farcaster/frame-sdk";

export default function FarcasterInit() {
  useEffect(() => {
    const initFarcaster = async () => {
      try {
        await sdk.actions.ready({ disableNativeGestures: true });
      } catch (error) {
        console.error("Failed to initialize Farcaster SDK:", error);
      }
    };
    initFarcaster();
  }, []);
  return null;
}
