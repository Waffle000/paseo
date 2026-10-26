import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { getDesktopHost } from "@/desktop/host";
import type { TextFilePreviewProps } from "../source/panel";
import { FilePanelLoading } from "../loading";
import { diagramEvent, diagramXml } from "./protocol";

const frameStyle: CSSProperties = { width: "100%", height: "100%", border: 0, flex: 1 };

export function DiagramPreview(props: TextFilePreviewProps) {
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const ready = useRef(false);
  const lastXml = useRef<string | null>(null);

  useEffect(() => {
    const bridge = getDesktopHost()?.diagram;
    if (!bridge) {
      setError("The offline diagram editor requires the custom desktop app.");
      return;
    }
    let disposed = false;
    void bridge
      .open()
      .then((url) => {
        if (disposed) return null;
        const source = new URL(url);
        source.search = new URLSearchParams({
          embed: "1",
          proto: "json",
          offline: "1",
          local: "1",
          noExitBtn: "1",
          saveAndExit: "0",
          spin: "1",
          libraries: "1",
          ui: "kennedy",
          lang: "en",
        }).toString();
        if (!latest.current.onChange) {
          source.searchParams.set("chrome", "0");
          source.searchParams.set("noSaveBtn", "1");
        }
        setEndpoint(source.toString());
        return source.toString();
      })
      .catch((failure: unknown) => {
        if (!disposed) setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!endpoint) return;
    // The sandbox has a unique opaque origin. Native navigation fencing keeps this
    // exact frame on the private editor endpoint; sibling frames are never trusted.
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== "null" ||
        event.source !== frame.current?.contentWindow ||
        typeof event.data !== "string"
      )
        return;
      try {
        const result = diagramEvent.safeParse(JSON.parse(event.data));
        if (!result.success) return;
        const message = result.data;
        if (message.event === "init") {
          const xml = diagramXml(latest.current.text);
          lastXml.current = xml;
          ready.current = true;
          frame.current?.contentWindow?.postMessage(
            JSON.stringify({
              action: "load",
              xml,
              autosave: latest.current.onChange ? 1 : 0,
              title: latest.current.target.path,
              modified: false,
            }),
            "*",
          );
        } else if (message.event === "autosave" || message.event === "save") {
          const xml = diagramXml(message.xml);
          if (!latest.current.onChange)
            throw new Error("This diagram is read-only at its current size or platform.");
          lastXml.current = xml;
          latest.current.onChange(xml);
          if (message.event === "save") latest.current.onSave?.();
        }
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    };
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
      ready.current = false;
    };
  }, [endpoint]);

  useEffect(() => {
    if (!endpoint || !ready.current) return;
    if (props.text !== lastXml.current && !props.modified) {
      try {
        const xml = diagramXml(props.text);
        lastXml.current = xml;
        frame.current?.contentWindow?.postMessage(
          JSON.stringify({
            action: "load",
            xml,
            autosave: props.onChange ? 1 : 0,
            title: props.target.path,
            modified: false,
          }),
          "*",
        );
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    }
    if (props.status) {
      let message = "Unsaved changes";
      if (props.status === "clean") message = "All changes saved";
      else if (props.status === "saving") message = "Saving…";
      else if (props.status === "error" || props.status === "conflict")
        message = "Save blocked — resolve the file error in the toolbar";
      frame.current?.contentWindow?.postMessage(
        JSON.stringify({ action: "status", message, modified: Boolean(props.modified) }),
        "*",
      );
    }
  }, [endpoint, props.text, props.modified, props.status, props.target.path, props.onChange]);

  if (error)
    return (
      <Text style={styles.error} testID="diagram-editor-error">
        {error}
      </Text>
    );
  if (!endpoint) return <FilePanelLoading />;
  return (
    <View style={styles.container}>
      <iframe
        ref={frame}
        src={endpoint}
        title="draw.io diagram editor"
        sandbox="allow-scripts allow-downloads allow-modals"
        referrerPolicy="no-referrer"
        style={frameStyle}
        data-testid="diagram-editor"
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  error: { padding: theme.spacing[4], color: theme.colors.destructive },
}));
