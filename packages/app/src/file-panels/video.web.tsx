import { useFileUrl } from "@getpaseo/plugin/client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { FilePanelLoading } from "./loading";
import type { BuiltinFilePanelProps } from "./panels";

const videoStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
  backgroundColor: "black",
};

export function VideoFilePanel({ file }: BuiltinFilePanelProps) {
  const url = useFileUrl(file);
  const active = useRetainedPanelActive();
  const video = useRef<HTMLVideoElement>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const { t } = useTranslation();
  const handleError = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    setFailedUrl(event.currentTarget.src);
  }, []);

  useEffect(() => {
    if (!active) video.current?.pause();
  }, [active]);

  if (url.status === "loading") return <FilePanelLoading />;
  if (url.status === "error") return <Text style={styles.error}>{url.error.message}</Text>;
  if (failedUrl === url.url) {
    return (
      <Text style={styles.error}>
        {t("panels.file.documentUnsupported", { type: file.mimeType })}
      </Text>
    );
  }
  return (
    <View style={styles.container}>
      <video
        ref={video}
        src={url.url}
        controls
        playsInline
        preload="metadata"
        aria-label={file.name}
        data-testid="video-file-preview"
        onError={handleError}
        style={videoStyle}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  error: { padding: theme.spacing[4], color: theme.colors.destructive },
}));
