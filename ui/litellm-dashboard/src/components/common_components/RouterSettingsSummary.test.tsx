import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RouterSettingsSummary from "./RouterSettingsSummary";

describe("RouterSettingsSummary", () => {
  it("shows deployment shares and warns when the strategy ignores weights", () => {
    render(
      <RouterSettingsSummary
        routerSettings={{ routing_strategy: "least-busy", weights: { chat: { primary: 4, backup: 1 } } }}
      />,
    );
    expect(screen.getByText("primary: 80% (weight 4)")).toBeInTheDocument();
    expect(screen.getByText("backup: 20% (weight 1)")).toBeInTheDocument();
    expect(screen.getByText("Inactive with least-busy; requires simple-shuffle")).toBeInTheDocument();
  });
  it("should list each configured fallback mapping", () => {
    render(
      <RouterSettingsSummary
        routerSettings={{
          fallbacks: [{ "gpt-4": ["gpt-4o", "claude-sonnet"] }, { "gpt-4o": ["gpt-4o-mini"] }],
          num_retries: 3,
        }}
      />,
    );

    expect(screen.getByText("gpt-4")).toBeInTheDocument();
    expect(screen.getByText("gpt-4o, claude-sonnet")).toBeInTheDocument();
    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
    expect(screen.getByText("gpt-4o-mini")).toBeInTheDocument();
    expect(screen.getByText("Number of Retries: 3")).toBeInTheDocument();
  });

  it("should show the empty state when every setting is null", () => {
    render(<RouterSettingsSummary routerSettings={{ fallbacks: null, num_retries: null }} />);

    expect(screen.getByText("No router settings configured")).toBeInTheDocument();
  });
});
