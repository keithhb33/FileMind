export const highEffortModel = "qwen3:14b";
export const lowEffortModel = "qwen3:4b";
export const recommendedModel = highEffortModel;

export type LocalModelChoice = {
  label: string;
  model: string;
  description: string;
};

export const localModelChoices: LocalModelChoice[] = [
  {
    label: "High Effort",
    model: highEffortModel,
    description: "Smarter local reasoning. Recommended when your computer can comfortably run the larger model."
  },
  {
    label: "Low Effort",
    model: lowEffortModel,
    description: "Faster local planning for smaller machines."
  }
];

export function choosePreferredModel(installedModelNames: string[]): string {
  const installed = new Map(installedModelNames.map((name) => [name.toLowerCase(), name]));
  return installed.get(highEffortModel) ?? installed.get(lowEffortModel) ?? "";
}

export function availableLocalModelChoices(installedModelNames: string[]): LocalModelChoice[] {
  const installed = new Map(installedModelNames.map((name) => [name.toLowerCase(), name]));
  return localModelChoices
    .map((choice) => {
      const installedName = installed.get(choice.model);
      return installedName ? { ...choice, model: installedName } : undefined;
    })
    .filter((choice): choice is LocalModelChoice => Boolean(choice));
}

export function localModelLabel(modelName: string): string {
  const normalized = modelName.toLowerCase();
  return localModelChoices.find((choice) => choice.model === normalized)?.label ?? "Local Model";
}

export function supportsThinking(modelName: string): boolean {
  return modelName.toLowerCase().startsWith("qwen3");
}
