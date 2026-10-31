import Svg, { Path } from "react-native-svg";
import { useUnistyles } from "react-native-unistyles";

interface PaseoLogoProps {
  size?: number;
  color?: string;
}

export function PaseoLogo({ size = 64, color }: PaseoLogoProps) {
  const { theme } = useUnistyles();
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      accessibilityLabel="MeowSh line-art cat"
    >
      <Path
        d="M29 75C17 66 14 50 20 38L18 17L37 29Q50 23 63 29L82 17L80 38C87 52 82 68 70 77C62 83 53 86 43 84C34 83 31 77 32 71C33 64 40 61 46 64C52 67 53 73 49 77"
        stroke={color ?? theme.colors.foreground}
        strokeWidth={6.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
