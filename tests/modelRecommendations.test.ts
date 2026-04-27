import { describe, expect, it } from "vitest";
import { availableLocalModelChoices, choosePreferredModel, supportsThinking } from "../src/shared/modelRecommendations";

describe("modelRecommendations", () => {
  it("prefers the High Effort local model when it is installed", () => {
    expect(choosePreferredModel(["llama3.2:latest", "qwen3:4b", "qwen3:14b", "gemma3:4b"])).toBe("qwen3:14b");
  });

  it("falls back to the Low Effort local model", () => {
    expect(choosePreferredModel(["llama3.2:latest", "qwen3:4b"])).toBe("qwen3:4b");
  });

  it("only exposes the supported local effort choices", () => {
    expect(availableLocalModelChoices(["llama3.2:latest", "qwen3:4b", "qwen3:1.7b"])).toEqual([
      expect.objectContaining({ label: "Low Effort", model: "qwen3:4b" })
    ]);
  });

  it("marks qwen3 models as thinking-capable", () => {
    expect(supportsThinking("qwen3:4b")).toBe(true);
    expect(supportsThinking("llama3.2:latest")).toBe(false);
  });
});
