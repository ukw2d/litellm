import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAllModelDeployments } from "@/app/(dashboard)/hooks/models/useModels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/shared/SearchSelect";
import {
  providerDeploymentGroups,
  providerWeightsError,
  providerWeightShares,
  ProviderWeightsValue,
} from "./providerWeightUtils";

interface ProviderWeightsProps {
  accessToken: string;
  teamId?: string | null;
  value: ProviderWeightsValue;
  onChange: (weights: ProviderWeightsValue) => void;
  strategy: string | null;
}

export default function ProviderWeights({ accessToken, teamId, value, onChange, strategy }: ProviderWeightsProps) {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const {
    data = [],
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["models", "list", { scope: "providerWeights", accessToken, teamId: teamId ?? null }],
    queryFn: () => fetchAllModelDeployments(accessToken, "", "", teamId ?? undefined),
    enabled: Boolean(accessToken),
  });
  const groups = providerDeploymentGroups(data);
  const options = Object.entries(groups)
    .filter(([group, deployments]) => deployments.length > 1 && !Object.hasOwn(value, group))
    .map(([group, deployments]) => ({ label: group, value: group, sublabel: `${deployments.length} deployments` }));
  const selectedDeployments = options.some((option) => option.value === selectedGroup)
    ? groups[selectedGroup!]
    : undefined;
  const error = providerWeightsError(value);
  const addSplit = () => {
    if (!selectedGroup || !selectedDeployments) return;
    const weights = Object.fromEntries(selectedDeployments.map((deployment) => [deployment.model_info!.id!, 1]));
    onChange({ ...value, [selectedGroup]: weights });
    setSelectedGroup(null);
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-medium">Provider traffic split</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Set relative weights within one public model group. Weights of 80 and 20 target an 80% / 20% split. Each
          request is chosen randomly, so percentages converge over time. Health checks and failover still apply;
          zero-weight backups may serve when positive-weight deployments are unavailable.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Router settings use the first configured object: key, then team, then global.
        </p>
      </div>
      {strategy !== "simple-shuffle" && (
        <p role="status" className="rounded-md border p-3 text-sm">
          {strategy
            ? `Provider weights are inactive with ${strategy}. Select simple-shuffle in Loadbalancing to apply them.`
            : "Provider weights apply only when the effective routing strategy is simple-shuffle. Select it in Loadbalancing to make this explicit."}
        </p>
      )}
      {isError ? (
        <div role="alert" className="text-sm">
          Unable to load deployments. Saved weights are retained.
          <Button type="button" variant="outline" size="sm" className="ml-2" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <SearchSelect
              aria-label="Model group for provider split"
              value={selectedGroup}
              onValueChange={setSelectedGroup}
              options={options}
              disabled={isPending}
              placeholder={isPending ? "Loading deployments..." : "Choose a model group"}
              emptyText="No unconfigured model groups with multiple deployments"
            />
          </div>
          <Button type="button" variant="outline" size="sm" disabled={!selectedDeployments} onClick={addSplit}>
            Add split
          </Button>
        </div>
      )}
      {Object.entries(value).map(([group, weights]) => {
        const deployments = groups[group] ?? [];
        const ids = Array.from(
          new Set([...Object.keys(weights), ...deployments.map((deployment) => deployment.model_info!.id!)]),
        );
        const shares = providerWeightShares(weights);
        return (
          <div key={group} className="rounded-lg border p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h4 className="break-all text-sm font-medium">{group}</h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Clear ${group} split`}
                onClick={() => onChange(Object.fromEntries(Object.entries(value).filter(([name]) => name !== group)))}
              >
                Clear group
              </Button>
            </div>
            <div className="space-y-3">
              {ids.map((id) => {
                const deployment = deployments.find((entry) => entry.model_info?.id === id);
                const weight = weights[id] ?? 0;
                const shareText = shares[id] === undefined ? "0%" : `${Number(shares[id].toFixed(2))}%`;
                return (
                  <div key={id} className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="break-all">{deployment?.litellm_params?.model ?? "Saved deployment"}</div>
                      <div className="break-all font-mono text-xs text-muted-foreground">{id}</div>
                      {!deployment && !isPending && !isError && (
                        <div className="text-xs text-muted-foreground">
                          Deployment is no longer in the available list
                        </div>
                      )}
                    </div>
                    <label className="w-24 space-y-1 text-xs">
                      <span>Weight</span>
                      <Input
                        type="number"
                        step="any"
                        aria-label={`${group} ${id} weight`}
                        aria-invalid={!Number.isFinite(weight) || weight < 0}
                        value={Number.isFinite(weight) ? weight : ""}
                        onChange={(event) =>
                          onChange({
                            ...value,
                            [group]: {
                              ...weights,
                              [id]: event.target.value === "" ? Number.NaN : Number(event.target.value),
                            },
                          })
                        }
                      />
                    </label>
                    <div className="w-24 text-right text-sm">
                      <div>{error ? "Invalid" : shareText}</div>
                      <div className="text-xs text-muted-foreground">Target share</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {Object.keys(value).length > 0 && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange({})}>
          Clear all provider splits
        </Button>
      )}
    </div>
  );
}
