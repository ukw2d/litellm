import json
from collections import Counter
from copy import deepcopy
from inspect import isawaitable

import httpx
import openai
import pytest

from litellm import Router
from litellm.types.router import DeploymentTypedDict, LiteLLMParamsTypedDict

DRAWS = 200


def _deployment(dep_id: str, metric: LiteLLMParamsTypedDict | None = None) -> DeploymentTypedDict:
    params: LiteLLMParamsTypedDict = {"model": "gpt-4o", "api_key": "key", "mock_response": f"from {dep_id}"}
    return {
        "model_name": "test-model",
        "litellm_params": {**params, **(metric or {})},
        "model_info": {"id": dep_id},
    }


async def _draw_model_ids(router: Router) -> Counter[str]:
    counts: Counter[str] = Counter()
    for _ in range(DRAWS):
        response = await router.acompletion(model="test-model", messages=[{"role": "user", "content": "hi"}])
        counts[response._hidden_params["model_id"]] += 1
    return counts


@pytest.mark.asyncio
@pytest.mark.parametrize("metric", [{"weight": 5}, {"rpm": 5}, {"tpm": 5}], ids=["weight", "rpm", "tpm"])
async def test_weighted_pick_when_only_a_later_deployment_carries_the_metric(metric: LiteLLMParamsTypedDict):
    router = Router(
        model_list=[_deployment("unweighted"), _deployment("weighted", metric)],
        routing_strategy="simple-shuffle",
        num_retries=0,
    )

    counts = await _draw_model_ids(router)

    assert counts["weighted"] == DRAWS
    assert counts["unweighted"] == 0


@pytest.mark.asyncio
async def test_uniform_pick_when_every_configured_weight_is_zero():
    router = Router(
        model_list=[_deployment("unweighted"), _deployment("standby", {"weight": 0})],
        routing_strategy="simple-shuffle",
        num_retries=0,
    )

    counts = await _draw_model_ids(router)

    assert counts["unweighted"] > 0
    assert counts["standby"] > 0


SELECTORS = (
    "get_available_deployment",
    "async_get_available_deployment",
    "get_available_deployment_for_pass_through",
    "async_get_available_deployment_for_pass_through",
)


@pytest.mark.asyncio
@pytest.mark.parametrize("selector", SELECTORS)
@pytest.mark.parametrize("metric", ["weight", "rpm", "tpm"])
@pytest.mark.parametrize("requested_model", ["test-model", "alias"])
async def test_scoped_weights_are_request_local_across_selectors(selector, metric, requested_model):
    router = Router(
        model_list=[
            _deployment("first", {metric: 100, "use_in_pass_through": True}),
            _deployment("second", {metric: 0, "use_in_pass_through": True}),
        ],
        model_group_alias={"alias": "test-model"},
        num_retries=0,
    )
    original_models = deepcopy(router.model_list)
    weights = {"test-model": {"second": 100}}
    cases = (
        ({"_router_weights": weights}, "second"),
        ({"_router_weights": {"test-model": {"first": 100}}}, "first"),
        ({"_router_weights": weights}, "second"),
        ({"_router_weights": {"different-group": {"second": 100}}}, "first"),
        ({}, "first"),
    )

    for kwargs, expected in cases:
        result = getattr(router, selector)(model=requested_model, request_kwargs=kwargs)
        deployment = await result if isawaitable(result) else result
        assert deployment["model_info"]["id"] == expected

    assert weights == {"test-model": {"second": 100}}
    assert router.model_list == original_models


@pytest.mark.asyncio
@pytest.mark.parametrize("selector", SELECTORS)
async def test_scoped_weights_cannot_select_another_teams_deployment(selector):
    router = Router(
        model_list=[
            _deployment("global", {"weight": 100, "use_in_pass_through": True}),
            {
                **_deployment("own", {"use_in_pass_through": True}),
                "model_info": {"id": "own", "team_id": "team-a"},
            },
            {
                **_deployment("foreign", {"use_in_pass_through": True}),
                "model_info": {"id": "foreign", "team_id": "team-b"},
            },
        ],
        num_retries=0,
    )
    result = getattr(router, selector)(
        model="test-model",
        request_kwargs={
            "metadata": {"user_api_key_team_id": "team-a"},
            "_router_weights": {"test-model": {"foreign": 100, "own": 1}},
        },
    )
    deployment = await result if isawaitable(result) else result

    assert deployment["model_info"]["id"] == "own"


@pytest.mark.asyncio
@pytest.mark.parametrize("selector", SELECTORS)
async def test_scoped_weights_use_global_backup_when_positive_candidates_are_blocked(selector):
    router = Router(
        model_list=[
            {
                **_deployment("blocked", {"use_in_pass_through": True}),
                "model_info": {"id": "blocked", "blocked": True},
            },
            _deployment("standby", {"weight": 0, "use_in_pass_through": True}),
            _deployment("backup", {"weight": 100, "use_in_pass_through": True}),
        ],
        num_retries=0,
    )
    result = getattr(router, selector)(
        model="test-model",
        request_kwargs={"_router_weights": {"test-model": {"blocked": 100, "standby": 0}}},
    )
    deployment = await result if isawaitable(result) else result

    assert deployment["model_info"]["id"] == "backup"


@pytest.mark.asyncio
@pytest.mark.parametrize("selector", SELECTORS)
@pytest.mark.parametrize("override_strategy", [False, True])
async def test_scoped_weights_leave_other_routing_strategies_in_control(selector, override_strategy):
    router = Router(
        model_list=[
            _deployment("first", {"weight": 0, "use_in_pass_through": True}),
            _deployment("second", {"weight": 100, "use_in_pass_through": True}),
        ],
        routing_strategy="simple-shuffle" if override_strategy else "least-busy",
        num_retries=0,
    )
    kwargs = {
        "_router_weights": {"test-model": {"second": 100}},
        **({"routing_strategy": "least-busy"} if override_strategy else {}),
    }

    result = getattr(router, selector)(model="test-model", request_kwargs=kwargs)
    deployment = await result if isawaitable(result) else result

    assert deployment["model_info"]["id"] == "first"


@pytest.mark.asyncio
@pytest.mark.parametrize("selector", SELECTORS)
async def test_explicit_deployment_selection_takes_precedence_over_scoped_weights(selector):
    router = Router(
        model_list=[
            _deployment("first", {"use_in_pass_through": True}),
            _deployment("second", {"use_in_pass_through": True}),
        ],
        num_retries=0,
    )

    result = getattr(router, selector)(
        model="first",
        request_kwargs={"_router_weights": {"test-model": {"second": 100}}},
    )
    deployment = await result if isawaitable(result) else result

    assert deployment["model_info"]["id"] == "first"


@pytest.mark.asyncio
async def test_scoped_weights_follow_the_current_fallback_model_group():
    router = Router(
        model_list=[
            _deployment("primary"),
            {**_deployment("fallback-first", {"weight": 100}), "model_name": "fallback-model"},
            {**_deployment("fallback-second", {"weight": 0}), "model_name": "fallback-model"},
        ],
        fallbacks=[{"test-model": ["fallback-model"]}],
        num_retries=0,
    )

    response = await router.acompletion(
        model="test-model",
        messages=[{"role": "user", "content": "hi"}],
        mock_testing_fallbacks=True,
        _router_weights={"test-model": {"primary": 100}, "fallback-model": {"fallback-second": 100}},
    )

    assert response._hidden_params["model_id"] == "fallback-second"


@pytest.mark.parametrize("method", ["completion", "text_completion"])
def test_sync_completion_entry_points_forward_scoped_weights(method):
    router = Router(
        model_list=[
            {**_deployment("first", {"weight": 100}), "model_name": "gpt-4o"},
            {**_deployment("second", {"weight": 0}), "model_name": "gpt-4o"},
        ],
        num_retries=0,
    )
    request = {"prompt": "hi"} if method == "text_completion" else {"messages": [{"role": "user", "content": "hi"}]}

    response = getattr(router, method)(model="gpt-4o", _router_weights={"gpt-4o": {"second": 100}}, **request)

    content = response.choices[0].text if method == "text_completion" else response.choices[0].message.content
    assert content == "from second"


def test_scoped_weights_handle_large_finite_values():
    router = Router(model_list=[_deployment("first"), _deployment("second")], num_retries=0)

    deployment = router.get_available_deployment(
        model="test-model",
        request_kwargs={"_router_weights": {"test-model": {"first": 1e308, "second": 1e308}}},
    )

    assert deployment["model_info"]["id"] in {"first", "second"}


@pytest.mark.asyncio
async def test_scoped_weights_select_provider_without_reaching_its_request_body():
    router = Router(
        model_list=[
            {
                "model_name": "test-model",
                "litellm_params": {"model": "gpt-4o", "api_key": "sk-test", "weight": weight},
                "model_info": {"id": deployment_id},
            }
            for deployment_id, weight in [("first", 100), ("second", 0)]
        ],
        num_retries=0,
    )
    wire_bodies = []

    def respond(request: httpx.Request) -> httpx.Response:
        wire_bodies.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-weighted", "object": "chat.completion", "created": 1, "model": "gpt-4o",
                "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            },
        )

    async with openai.AsyncOpenAI(
        api_key="sk-test", http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond))
    ) as client:
        response = await router.acompletion(
            model="test-model",
            messages=[{"role": "user", "content": "hi"}],
            _router_weights={"test-model": {"second": 100}},
            client=client,
        )

    assert response._hidden_params["model_id"] == "second"
    assert len(wire_bodies) == 1
    assert wire_bodies[0]["messages"] == [{"role": "user", "content": "hi"}]
    assert "_router_weights" not in wire_bodies[0]
    assert "weights" not in wire_bodies[0]
