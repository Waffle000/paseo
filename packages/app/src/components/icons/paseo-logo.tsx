import { useId } from "react";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

interface PaseoLogoProps {
  size?: number;
  color?: string;
}

export function PaseoLogo({ size = 64, color }: PaseoLogoProps) {
  const furId = useId();
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      accessibilityLabel="MeowSh striped cat"
    >
      <Defs>
        <LinearGradient id={furId} x1="0" y1="0" x2="0" y2="1">
          <Stop stopColor="#ffe6bd" />
          <Stop offset="1" stopColor="#dfa977" />
        </LinearGradient>
      </Defs>
      <Rect x={2} y={2} width={96} height={96} rx={23} fill="#202b40" />
      <Path
        d="M22 46 18 19 37 30Q50 25 63 30L82 19 78 46Q87 65 73 78Q50 94 27 78Q13 65 22 46Z"
        fill={`url(#${furId})`}
        stroke={color ?? "#111a29"}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Path d="m24 27 3 13 8-7Zm52 0-3 13-8-7Z" fill="#cf827a" />
      <Path
        d="m43 31 3 10 4-7 4 7 3-10M23 48l10 4m-11 4 10 3m45-11-10 4m11 4-10 3"
        stroke="#835b45"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="m35 57 6 5-6 5m30-10-6 5 6 5"
        stroke="#1b2936"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M47 69q3-3 6 0l-3 4Z" fill="#9c5860" />
      <Path
        d="M50 73v3m0 0q-4 5-8 0m8 0q4 5 8 0"
        stroke="#6d453c"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="m35 70-12-2m12 6-12 2m42-6 12-2m-12 6 12 2"
        stroke="#b17f59"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <Path d="M42 92h16" stroke="#8be0d2" strokeWidth={2.5} strokeLinecap="round" />
    </Svg>
  );
}
