/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { diagramXml } from "./protocol";

describe("diagram document boundary", () => {
  it("refuses non-diagram documents and malformed XML instead of loading them as an editor file", () => {
    expect(() => diagramXml("<html><script>bad()</script></html>")).toThrow("valid draw.io");
    expect(() => diagramXml("<mxfile><diagram></mxfile>")).toThrow("valid draw.io");
  });
  it("refuses document types and entity declarations before XML parsing", () => {
    expect(() =>
      diagramXml(
        '<!DOCTYPE mxfile [<!ENTITY data SYSTEM "file:///private/data">]><mxfile>&data;</mxfile>',
      ),
    ).toThrow("document types or entities");
  });
});
