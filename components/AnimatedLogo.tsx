/**
 * Animated Resumax logo component with multiple animation styles.
 *
 * Built on react-native-svg — raw HTML <svg>/<path> tags (an earlier version
 * of this file used those) only render under React Native Web. On a real
 * device or in Expo Go they're not a recognised host component, so the logo
 * silently rendered nothing. react-native-svg's <Svg>/<Path> are actual
 * native views and work everywhere the rest of the app does.
 *
 * Usage:
 *   <AnimatedLogo variant="draw" size={100} />
 *   <AnimatedLogo variant="pulse" size={80} />
 *   <AnimatedLogo variant="bounce" size={120} />
 *   <AnimatedLogo variant="arrow-pulse" size={100} />
 */

import React, { useEffect, useRef } from "react";
import { Animated, View } from "react-native";
import Svg, { G, Path } from "react-native-svg";
import { useTheme } from "@/hooks/useTheme";

const AnimatedPath = Animated.createAnimatedComponent(Path);

type AnimationVariant = "draw" | "pulse" | "bounce" | "arrow-pulse" | "static";

interface AnimatedLogoProps {
  variant?: AnimationVariant;
  size?: number;
  speed?: "slow" | "normal" | "fast";
  color?: string;
}

// ── Geometry — mirrors assets/brand/mark.py so every rendering of the logo
// (native app icon, splash PNGs, this animated component) is the same glyph.
const STROKE = 12.0;
const VIEW = 100.0;
const LEFT = 0.0;
const RIGHT = 60.0;
const TOP = 0.0;
const BOTTOM = 46.0;
const VALLEY_FRAC = 0.6;
const LEAN = 0.06;
const ARROW_LEN = 30.0;
const HEAD_LEN = 21.0;
const HEAD_ANGLE = 42.0;

const MID = (LEFT + RIGHT) / 2.0;
const VALLEY = TOP + (BOTTOM - TOP) * VALLEY_FRAC;

function getMPath(): string {
  const points = [
    `${LEFT} ${BOTTOM}`,
    `${LEFT + (MID - LEFT) * LEAN} ${TOP}`,
    `${MID} ${VALLEY}`,
    `${RIGHT - (RIGHT - MID) * LEAN} ${TOP}`,
    `${RIGHT} ${BOTTOM}`,
  ];
  return `M ${points[0]} L ${points.slice(1).join(" L ")}`;
}

function arrowGeometry() {
  const x0 = MID;
  const y0 = VALLEY;
  const x1 = RIGHT - (RIGHT - MID) * LEAN;
  const y1 = TOP;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const tipX = x1 + ux * ARROW_LEN;
  const tipY = y1 + uy * ARROW_LEN;
  return { x1, y1, tipX, tipY, ux, uy };
}

function getArrowShaftPath(): string {
  const { x1, y1, tipX, tipY } = arrowGeometry();
  return `M ${x1} ${y1} L ${tipX} ${tipY}`;
}

function headBarbPoints(): [[number, number], [number, number]] {
  const { tipX, tipY, ux, uy } = arrowGeometry();
  const barbs: [number, number][] = [];
  for (const sign of [1.0, -1.0]) {
    const a = ((HEAD_ANGLE * Math.PI) / 180) * sign;
    const rx = -ux * Math.cos(a) + uy * Math.sin(a);
    const ry = -ux * Math.sin(a) - uy * Math.cos(a);
    barbs.push([tipX + rx * HEAD_LEN, tipY + ry * HEAD_LEN]);
  }
  return barbs as [[number, number], [number, number]];
}

function getArrowHeadPath(): string {
  const { tipX, tipY } = arrowGeometry();
  const [b1, b2] = headBarbPoints();
  return `M ${b1[0]} ${b1[1]} L ${tipX} ${tipY} L ${b2[0]} ${b2[1]}`;
}

const M_PATH = getMPath();
const SHAFT_PATH = getArrowShaftPath();
const HEAD_PATH = getArrowHeadPath();

// Generous upper bound on stroke length. Doesn't need to be exact — a
// dasharray longer than the real path still hides it fully at full offset
// and reveals it fully at zero offset, which is all "draw" needs.
const DASH_LENGTH = 220;

/**
 * Bounding box of the drawn artwork, including the stroke's half-width —
 * mirrors assets/brand/mark.py's _bbox() exactly. Round caps/joins mean every
 * stroked vertex extends STROKE/2 in all directions, so padding by that is
 * exact rather than approximate.
 *
 * Without this, the raw geometry (drawn straight into a 0..100 viewBox) gets
 * clipped: the arrowhead's tip lands at y ≈ -21 and its barb at y ≈ -26,
 * both above the viewBox's top edge, so the top of the mark — the arrow
 * itself — was silently cut off on every render.
 */
function computeBBox() {
  const half = STROKE / 2;
  const pts: [number, number][] = [
    [LEFT, BOTTOM],
    [LEFT + (MID - LEFT) * LEAN, TOP],
    [MID, VALLEY],
    [RIGHT - (RIGHT - MID) * LEAN, TOP],
    [RIGHT, BOTTOM],
  ];
  const { x1: sx, y1: sy, tipX, tipY } = arrowGeometry();
  pts.push([sx, sy], [tipX, tipY], ...headBarbPoints());

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x - half);
    maxX = Math.max(maxX, x + half);
    minY = Math.min(minY, y - half);
    maxY = Math.max(maxY, y + half);
  }
  return { minX, minY, maxX, maxY };
}

// Scale + translate that centres the artwork in the VIEW x VIEW square with
// a small margin — mirrors mark.py's _fit_transform(). Applied as a <G>
// transform on every variant below, instead of relying on the raw viewBox.
const FIT_MARGIN_FRAC = 0.06;
const BBOX = computeBBox();
const BBOX_W = BBOX.maxX - BBOX.minX;
const BBOX_H = BBOX.maxY - BBOX.minY;
const FIT_SCALE = (VIEW * (1 - FIT_MARGIN_FRAC * 2)) / Math.max(BBOX_W, BBOX_H);
const FIT_TX = (VIEW - BBOX_W * FIT_SCALE) / 2 - BBOX.minX * FIT_SCALE;
const FIT_TY = (VIEW - BBOX_H * FIT_SCALE) / 2 - BBOX.minY * FIT_SCALE;
const FIT_TRANSFORM = `translate(${FIT_TX} ${FIT_TY}) scale(${FIT_SCALE})`;

export function AnimatedLogo({
  variant = "draw",
  size = 100,
  speed = "normal",
  color: colorProp,
}: AnimatedLogoProps) {
  const { theme } = useTheme();
  const color = colorProp || theme.primary;
  const speedMultiplier = speed === "slow" ? 1.5 : speed === "fast" ? 0.6 : 1;

  switch (variant) {
    case "draw":
      return <DrawingAnimation size={size} color={color} speedMultiplier={speedMultiplier} />;
    case "pulse":
      return <PulseAnimation size={size} color={color} speedMultiplier={speedMultiplier} />;
    case "bounce":
      return <BounceAnimation size={size} color={color} speedMultiplier={speedMultiplier} />;
    case "arrow-pulse":
      return <ArrowPulseAnimation size={size} color={color} speedMultiplier={speedMultiplier} />;
    case "static":
    default:
      return <StaticLogo size={size} color={color} />;
  }
}

function StaticLogo({ size, color }: { size: number; color: string }) {
  const common = {
    fill: "none" as const,
    stroke: color,
    strokeWidth: STROKE,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`}>
      <G transform={FIT_TRANSFORM}>
        <Path d={M_PATH} {...common} />
        <Path d={SHAFT_PATH} {...common} />
        <Path d={HEAD_PATH} {...common} />
      </G>
    </Svg>
  );
}

/**
 * Draws each stroke in turn via an animated strokeDashoffset, looping.
 */
function DrawingAnimation({
  size,
  color,
  speedMultiplier,
}: {
  size: number;
  color: string;
  speedMultiplier: number;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progress.setValue(0);
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1400 / speedMultiplier,
        useNativeDriver: false, // strokeDashoffset isn't a native-driver prop
      })
    );
    loop.start();
    return () => loop.stop();
  }, [speedMultiplier]);

  const dashOffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [DASH_LENGTH, 0],
  });

  const common = {
    fill: "none" as const,
    stroke: color,
    strokeWidth: STROKE,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeDasharray: `${DASH_LENGTH}`,
  };

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`}>
        <G transform={FIT_TRANSFORM}>
          <AnimatedPath d={M_PATH} {...common} strokeDashoffset={dashOffset} />
          <AnimatedPath d={SHAFT_PATH} {...common} strokeDashoffset={dashOffset} />
          <AnimatedPath d={HEAD_PATH} {...common} strokeDashoffset={dashOffset} />
        </G>
      </Svg>
    </View>
  );
}

/**
 * Breathing scale + opacity pulse. Animates the wrapping View, not SVG
 * internals, so it can safely use the native driver.
 */
function PulseAnimation({
  size,
  color,
  speedMultiplier,
}: {
  size: number;
  color: string;
  speedMultiplier: number;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scaleAnim, {
            toValue: 1.1,
            duration: 600 / speedMultiplier,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 600 / speedMultiplier,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(opacityAnim, {
            toValue: 0.55,
            duration: 600 / speedMultiplier,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: 600 / speedMultiplier,
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [speedMultiplier]);

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        transform: [{ scale: scaleAnim }],
        opacity: opacityAnim,
      }}
    >
      <StaticLogo size={size} color={color} />
    </Animated.View>
  );
}

/**
 * Vertical bounce, native-driven via transform.
 */
function BounceAnimation({
  size,
  color,
  speedMultiplier,
}: {
  size: number;
  color: string;
  speedMultiplier: number;
}) {
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(translateY, {
          toValue: -15,
          duration: 400 / speedMultiplier,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 400 / speedMultiplier,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [speedMultiplier]);

  return (
    <Animated.View style={{ width: size, height: size, transform: [{ translateY }] }}>
      <StaticLogo size={size} color={color} />
    </Animated.View>
  );
}

/**
 * The M stays static; only the arrow shaft + head pulse opacity/width.
 */
function ArrowPulseAnimation({
  size,
  color,
  speedMultiplier,
}: {
  size: number;
  color: string;
  speedMultiplier: number;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 600 / speedMultiplier,
          useNativeDriver: false, // driving strokeWidth, not a native-driver prop
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 600 / speedMultiplier,
          useNativeDriver: false,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [speedMultiplier]);

  const arrowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const arrowWidth = pulse.interpolate({ inputRange: [0, 1], outputRange: [STROKE, STROKE + 2] });

  const arrowCommon = {
    fill: "none" as const,
    stroke: color,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: arrowWidth,
    opacity: arrowOpacity,
  };

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`}>
        <G transform={FIT_TRANSFORM}>
          <Path
            d={M_PATH}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <AnimatedPath d={SHAFT_PATH} {...arrowCommon} />
          <AnimatedPath d={HEAD_PATH} {...arrowCommon} />
        </G>
      </Svg>
    </View>
  );
}
