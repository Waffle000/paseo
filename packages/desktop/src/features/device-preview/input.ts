import { z } from "zod";

export const previewAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tap"), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  z.object({
    kind: z.literal("swipe"),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    endX: z.number().min(0).max(1),
    endY: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal("text"),
    text: z
      .string()
      .min(1)
      .max(2000)
      .regex(/^[\x20-\x7E\r\n]+$/),
  }),
  z.object({ kind: z.literal("home") }),
  z.object({ kind: z.literal("back") }),
]);
export type PreviewAction = z.infer<typeof previewAction>;

function quoteText(text: string): string {
  const encoded = text.replaceAll(" ", "%s");
  return `'${encoded.replaceAll("'", "'\\''")}'`;
}

/** Android interprets literal %s as a space even inside shell quotes. Send that pair separately. */
export function androidTextCommands(text: string): string[] {
  if (!text.includes("%s")) return [quoteText(text)];
  const commands: string[] = [];
  let from = 0;
  let match = text.indexOf("%s");
  while (match !== -1) {
    if (match > from) commands.push(quoteText(text.slice(from, match)));
    commands.push(quoteText("%"), quoteText("s"));
    from = match + 2;
    match = text.indexOf("%s", from);
  }
  if (from < text.length) commands.push(quoteText(text.slice(from)));
  return commands;
}
