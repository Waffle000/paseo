import { z } from "zod";

export const diagramEvent = z.discriminatedUnion("event", [
  z.object({ event: z.literal("init") }),
  z.object({ event: z.literal("load") }),
  z.object({ event: z.literal("autosave"), xml: z.string() }),
  z.object({ event: z.literal("save"), xml: z.string() }),
]);

export function diagramXml(text: string): string {
  if (text.trim() === "")
    return '<mxfile><diagram name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("Diagram XML must not contain document types or entities.");
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (
    document.querySelector("parsererror") ||
    !["mxfile", "mxGraphModel"].includes(document.documentElement.localName)
  ) {
    throw new Error("This file is not a valid draw.io diagram.");
  }
  return text;
}
