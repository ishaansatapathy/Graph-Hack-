"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Flip } from "gsap/Flip";
import { useGSAP } from "@gsap/react";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, Flip, useGSAP);
}

export const EASE_OUT = "expo.out";
export const EASE_QUART = "quart.out";
export const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
export const MOTION_QUERY = "(prefers-reduced-motion: no-preference)";

export { gsap, ScrollTrigger, Flip, useGSAP };
