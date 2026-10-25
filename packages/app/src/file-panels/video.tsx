import { useFileUrl } from "@getpaseo/plugin/client";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { DocumentFrame } from "./document-frame";
import { FilePanelLoading } from "./loading";
import type { BuiltinFilePanelProps } from "./panels";

export function VideoFilePanel({ file }: BuiltinFilePanelProps) {
  const url = useFileUrl(file);
  if (url.status === "loading") return <FilePanelLoading />;
  if (url.status === "error") return <Text style={styles.error}>{url.error.message}</Text>;
  return <DocumentFrame url={url.url} testID="video-file-preview" />;
}

const styles = StyleSheet.create((theme) => ({
  error: { padding: theme.spacing[4], color: theme.colors.destructive },
}));
