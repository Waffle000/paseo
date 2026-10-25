import { z } from "zod";

export const inputSchema = z.object({
  dataDir: z.string().min(1),
  connectionId: z.string().min(1).max(512),
  provider: z.string().min(1),
  enabled: z.boolean(),
  status: z.string().max(128),
});
export type Input = z.infer<typeof inputSchema>;
