import { describe, expect, it } from "vitest";
import { providerDeploymentGroups, providerWeightsError, providerWeightShares } from "./providerWeightUtils";

describe("provider weights", () => {
  it.each([undefined, null, {}, { chat: { primary: 4, backup: 1, spare: 0 } }])(
    "accepts configured weights or an explicit clear (%j)",
    (value) => {
      expect(providerWeightsError(value)).toBeNull();
    },
  );

  it.each([
    { chat: { a: -1, b: 2 } },
    { chat: { a: Number.NaN } },
    { chat: { a: Number.POSITIVE_INFINITY } },
    { chat: { a: "5" } },
    { chat: { a: null } },
    { chat: { a: 0, b: 0 } },
    { chat: {} },
    { chat: { "": 1 } },
    { "": { a: 1 } },
    { chat: [] },
    [],
  ])("rejects an invalid configured split (%j)", (value) => {
    expect(providerWeightsError(value)).not.toBeNull();
  });

  it("normalizes ratios and zero backups without overflowing finite weights", () => {
    expect(providerWeightShares({ a: 4, b: 1, backup: 0 })).toEqual({ a: 80, b: 20, backup: 0 });
    expect(providerWeightShares({ a: 1e308, b: 1e308 })).toEqual({ a: 50, b: 50 });
    expect(providerWeightShares({ a: 0 })).toEqual({});
  });

  it("groups distinct stable deployment IDs by public model name", () => {
    const first = { model_name: "chat", model_info: { id: "a" }, litellm_params: { model: "openai/gpt-5" } };
    const second = { model_name: "chat", model_info: { id: "b" }, litellm_params: { model: "azure/gpt-5" } };
    expect(providerDeploymentGroups([first, first, second, { model_name: "chat" }])).toEqual({ chat: [first, second] });
  });
});
