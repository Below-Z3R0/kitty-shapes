import { describe, expect, test } from "bun:test";
import { flagList, flagNumber, parseArgs } from "../src/cli/args";

describe("parseArgs", () => {
  test("separa comando, posicionales y flags", () => {
    const { command, positional, flags } = parseArgs(["build", "osito.png", "--size", "800"]);
    expect(command).toBe("build");
    expect(positional).toEqual(["osito.png"]);
    expect(flags.get("size")).toBe("800");
  });

  test("--clave=valor no consume el siguiente token", () => {
    const { positional, flags } = parseArgs(["pick", "a.png", "--shape=cookie12", "b.png"]);
    expect(flags.get("shape")).toBe("cookie12");
    expect(positional).toEqual(["a.png", "b.png"]);
  });

  test("un flag sin valor queda en true", () => {
    const { flags } = parseArgs(["build", "a.png", "--square"]);
    expect(flags.get("square")).toBe("true");
  });

  test("un flag seguido de otro no se come el segundo", () => {
    const { flags } = parseArgs(["pick", "a.png", "--escape", "--path"]);
    expect(flags.get("escape")).toBe("true");
    expect(flags.get("path")).toBe("true");
  });
});

describe("flagNumber", () => {
  test("usa el fallback si no está", () => {
    expect(flagNumber(new Map(), "inset", 0.02)).toBe(0.02);
  });

  test("rechaza lo que no es número", () => {
    expect(() => flagNumber(new Map([["inset", "mucho"]]), "inset", 0.02)).toThrow();
  });
});

describe("flagList", () => {
  test("separa por coma", () => {
    expect(flagList(new Map([["shapes", "arch,cookie12"]]), "shapes", [])).toEqual(["arch", "cookie12"]);
  });

  test("rechaza una forma que no existe", () => {
    expect(() => flagList(new Map([["shapes", "arch,no-existe"]]), "shapes", [])).toThrow(/no-existe/);
  });
});
