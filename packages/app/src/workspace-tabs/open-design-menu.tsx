import { useMemo } from "react";
import { Text } from "react-native";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSessionStore } from "@/stores/session-store";
import { StyleSheet } from "react-native-unistyles";

export function OpenDesignMenu({
  serverId,
  workspaceId,
  onOpen,
  onHandoff,
}: {
  serverId: string;
  workspaceId: string;
  onOpen: () => void;
  onHandoff: (agentId: string) => void;
}) {
  const directory = useSessionStore((state) => state.sessions[serverId]?.agents);
  const agents = useMemo(
    () =>
      Array.from(directory?.values() ?? [])
        .filter(
          (agent) => agent.workspaceId === workspaceId && !agent.archivedAt && !agent.parentAgentId,
        )
        .map((agent) => ({
          id: agent.id,
          label: agent.title || agent.provider,
          select: () => onHandoff(agent.id),
        })),
    [directory, workspaceId, onHandoff],
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel="Open Design and agent handoff"
        testID="open-design-menu"
        style={styles.trigger}
      >
        <Text style={styles.label}>Design</Text>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={onOpen}>Open Design</DropdownMenuItem>
        {agents.map((agent) => (
          <DropdownMenuItem key={agent.id} onSelect={agent.select}>
            Send design context to {agent.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
const styles = StyleSheet.create((theme) => ({
  trigger: { paddingHorizontal: 10, paddingVertical: 6 },
  label: { color: theme.colors.foreground, fontSize: 12 },
}));
