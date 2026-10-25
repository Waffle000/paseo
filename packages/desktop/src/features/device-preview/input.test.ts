import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { androidTextCommands, previewAction } from "./input";

function deliverThroughShell(text: string): string {
  return androidTextCommands(text)
    .map((argument) =>
      execFileSync("/bin/sh", ["-c", `printf '%s' ${argument}`], { encoding: "utf8" }).replaceAll(
        "%s",
        " ",
      ),
    )
    .join("");
}

describe("device input boundary", () => {
  it("rejects coordinates that would miss the captured screen", () => {
    for (const coordinate of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(previewAction.safeParse({ kind: "tap", x: coordinate, y: 0.5 }).success).toBe(false);
      expect(
        previewAction.safeParse({ kind: "swipe", x: 0, y: 0, endX: 1, endY: coordinate }).success,
      ).toBe(false);
    }
    expect(previewAction.parse({ kind: "tap", x: 0, y: 1 })).toEqual({ kind: "tap", x: 0, y: 1 });
  });

  it("rejects control bytes and unsupported keyboard input before dispatch", () => {
    for (const text of ["", "hello\0world", "\u001b[31m", "你好", "x".repeat(2001)]) {
      expect(previewAction.safeParse({ kind: "text", text }).success).toBe(false);
    }
    expect(previewAction.parse({ kind: "text", text: "PalmOne 23/10\nOK" })).toEqual({
      kind: "text",
      text: "PalmOne 23/10\nOK",
    });
  });

  it.skipIf(process.platform === "win32")(
    "delivers shell syntax as text instead of executing substitutions or commands",
    () => {
      for (const text of [
        "hello world",
        "it's correct",
        "$(printf INJECTED)",
        "x; printf INJECTED",
        "`printf INJECTED`",
        "a\"b'c\\d",
        "100% complete",
        "literal%svalue",
        "%s%s",
        "a\nb",
      ]) {
        expect(deliverThroughShell(text)).toBe(text);
      }
    },
  );
});
