import { ChevronRight } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { extraMutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { PressHighlight } from "@/components/ui/press-highlight";
import { StatusBadge } from "@/components/ui/status-badge";
import { settingsStyles } from "@/styles/settings";
import { UsageCard } from "./card";
import type { UsageDisplay } from "./display";
import { useUsageInSidebar } from "./in-sidebar";
import type { UsageReportGroup } from "./model";

const ThemedChevronRight = withUnistyles(ChevronRight);

/** 9router accounts start collapsed by provider; other sources keep their cards. */
export function UsageList({
  serverId,
  groups,
  display,
}: {
  serverId: string;
  groups: UsageReportGroup[];
  display: UsageDisplay;
}) {
  const { inSidebar } = useUsageInSidebar();
  return (
    <View style={styles.list}>
      {groups.map((group) => (
        <UsageGroup
          key={group.id}
          group={group}
          serverId={serverId}
          display={display}
          pinnable={inSidebar}
        />
      ))}
    </View>
  );
}

function UsageGroup({
  group,
  serverId,
  display,
  pinnable,
}: {
  group: UsageReportGroup;
  serverId: string;
  display: UsageDisplay;
  pinnable: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const headerStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.groupHeader,
      hovered && styles.hovered,
      pressed && styles.pressed,
    ],
    [hovered],
  );
  return (
    <View style={settingsStyles.card}>
      {group.collapsible ? (
        <PressHighlight
          accessibilityRole="button"
          accessibilityLabel={`${group.label} (${group.reports.length})`}
          accessibilityState={accessibilityState}
          aria-expanded={expanded}
          onPress={toggle}
          onHoverIn={hoverIn}
          onHoverOut={hoverOut}
          style={headerStyle}
          highlightStyle={styles.pressed}
        >
          <ThemedChevronRight
            size={16}
            uniProps={extraMutedIconColorMapping}
            style={expanded ? styles.expandedChevron : undefined}
          />
          <Text style={styles.groupLabel}>{group.label}</Text>
          <StatusBadge label={String(group.reports.length)} variant="muted" size="xs" />
        </PressHighlight>
      ) : null}
      {!group.collapsible || expanded
        ? group.reports.map((entry) => (
            <View key={entry.id} style={group.collapsible ? settingsStyles.rowBorder : undefined}>
              <UsageCard
                serverId={serverId}
                entry={entry}
                display={display}
                pinnable={pinnable}
                refreshable
              />
            </View>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: { gap: theme.spacing[3] },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  groupLabel: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  expandedChevron: { transform: [{ rotate: "90deg" }] },
  hovered: { backgroundColor: theme.colors.surface3 },
  pressed: { opacity: 0.7 },
}));
