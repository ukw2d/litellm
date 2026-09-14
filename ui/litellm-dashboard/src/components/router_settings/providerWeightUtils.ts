import type { AutoRouterDeployment } from "@/app/(dashboard)/hooks/models/useModels";

export type ProviderWeightsValue = Record<string, Record<string, number>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const providerWeightsError = (weights: unknown): string | null => {
  if (weights == null) return null;
  if (!isRecord(weights)) return "Provider weights must be grouped by model";
  for (const [group, deployments] of Object.entries(weights)) {
    if (!group.trim() || !isRecord(deployments))
      return "Each provider split needs a model group and deployment weights";
    const entries = Object.entries(deployments);
    if (
      entries.some(([id, weight]) => !id.trim() || typeof weight !== "number" || !Number.isFinite(weight) || weight < 0)
    ) {
      return `${group}: enter a finite, nonnegative weight for every deployment`;
    }
    if (!entries.some(([, weight]) => typeof weight === "number" && weight > 0)) {
      return `${group}: at least one deployment must have a positive weight`;
    }
  }
  return null;
};

export const providerWeightShares = (weights: Record<string, number>): Record<string, number> => {
  if (providerWeightsError({ group: weights })) return {};
  const maximum = Math.max(...Object.values(weights));
  const total = Object.values(weights).reduce((sum, weight) => sum + weight / maximum, 0);
  return Object.fromEntries(Object.entries(weights).map(([id, weight]) => [id, (weight / maximum / total) * 100]));
};

export const providerDeploymentGroups = (deployments: AutoRouterDeployment[]): Record<string, AutoRouterDeployment[]> =>
  Object.fromEntries(
    Array.from(new Set(deployments.map((deployment) => deployment.model_name).filter(Boolean))).map((group) => [
      group,
      Array.from(
        new Map(
          deployments
            .filter((deployment) => deployment.model_name === group && deployment.model_info?.id)
            .map((deployment) => [deployment.model_info!.id, deployment]),
        ).values(),
      ),
    ]),
  );
