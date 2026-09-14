import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { modelInfoCall } from "../networking";
import ProviderWeights from "./ProviderWeights";
import type { ProviderWeightsValue } from "./providerWeightUtils";

vi.mock("../networking", () => ({ modelInfoCall: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const deployment = (id: string, model = "chat") => ({
  model_name: model,
  model_info: { id },
  litellm_params: { model: id === "a" ? "openai/gpt-5" : "azure/gpt-5" },
});

describe("ProviderWeights", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads every scoped page and edits normalized shares, then clears the saved group", async () => {
    vi.mocked(modelInfoCall).mockImplementation(async (_token, _user, _role, page) => ({
      data: [deployment(page === 1 ? "a" : "b")],
      total_pages: 2,
    }));
    const changed = vi.fn();
    const Harness = () => {
      const [value, setValue] = useState<ProviderWeightsValue>({});
      return (
        <ProviderWeights
          accessToken="token"
          teamId="team-a"
          strategy="simple-shuffle"
          value={value}
          onChange={(next) => {
            setValue(next);
            changed(next);
          }}
        />
      );
    };
    render(<Harness />, { wrapper });
    const user = userEvent.setup();
    const selector = screen.getByRole("combobox", { name: "Model group for provider split" });
    await waitFor(() => expect(selector).toBeEnabled());
    await user.click(selector);
    await user.type(selector, "chat");
    await user.click(await screen.findByRole("option", { name: /chat/ }));
    await user.click(screen.getByRole("button", { name: "Add split" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "chat a weight" }), { target: { value: "4" } });
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(changed).toHaveBeenLastCalledWith({ chat: { a: 4, b: 1 } });
    expect(modelInfoCall).toHaveBeenCalledWith("token", "", "", 1, 1000, undefined, undefined, "team-a");
    expect(modelInfoCall).toHaveBeenCalledWith("token", "", "", 2, 1000, undefined, undefined, "team-a");
    await user.click(screen.getByRole("button", { name: "Clear chat split" }));
    expect(changed).toHaveBeenLastCalledWith({});
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("preserves saved IDs on listing failure, exposes invalid edits and shows inactive strategy", async () => {
    vi.mocked(modelInfoCall).mockRejectedValue(new Error("unavailable"));
    const Harness = () => {
      const [value, setValue] = useState<ProviderWeightsValue>({ chat: { retired: 2 } });
      return <ProviderWeights accessToken="token" strategy="least-busy" value={value} onChange={setValue} />;
    };
    render(<Harness />, { wrapper });
    expect(await screen.findByText("Unable to load deployments. Saved weights are retained.")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "chat retired weight" })).toHaveValue(2);
    expect(screen.getByRole("status")).toHaveTextContent("Provider weights are inactive with least-busy");
    fireEvent.change(screen.getByRole("spinbutton", { name: "chat retired weight" }), { target: { value: "0" } });
    expect(screen.getByText("chat: at least one deployment must have a positive weight")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "chat retired weight" }), { target: { value: "" } });
    expect(screen.getByText("chat: enter a finite, nonnegative weight for every deployment")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear all provider splits" }));
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("does not display a late response for a previously selected team", async () => {
    let resolveOld: (value: { data: ReturnType<typeof deployment>[] }) => void = () => {};
    vi.mocked(modelInfoCall).mockImplementation(async (...args: Parameters<typeof modelInfoCall>) =>
      args[7] === "old"
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : { data: [deployment("a", "new"), deployment("b", "new")] },
    );
    const { rerender } = render(
      <ProviderWeights accessToken="token" teamId="old" strategy="simple-shuffle" value={{}} onChange={vi.fn()} />,
      { wrapper },
    );
    await waitFor(() => expect(modelInfoCall).toHaveBeenCalledTimes(1));
    rerender(
      <ProviderWeights accessToken="token" teamId="new" strategy="simple-shuffle" value={{}} onChange={vi.fn()} />,
    );
    await act(async () => resolveOld({ data: [deployment("a", "old"), deployment("b", "old")] }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox"));
    expect(await screen.findByRole("option", { name: /new/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /old/ })).not.toBeInTheDocument();
  });
});
