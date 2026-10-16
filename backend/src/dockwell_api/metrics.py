"""Prometheus metrics for the gateway, scraped by the bundled Prometheus (self-hosted)."""

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

REQUESTS = Counter("dockwell_requests_total", "Gateway requests", ["model", "source", "status"])
TOKENS = Counter("dockwell_tokens_total", "Tokens processed", ["model", "direction"])
COST = Counter("dockwell_cost_micros_total", "Credits charged (micro-dollars)", ["model"])
LATENCY = Histogram(
    "dockwell_request_latency_seconds",
    "End-to-end gateway latency",
    ["model"],
    buckets=(0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 40, 80, 160),
)
TTFT = Histogram(
    "dockwell_time_to_first_token_seconds",
    "Time to first token for streamed requests",
    ["model"],
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10),
)
IN_FLIGHT = Gauge("dockwell_requests_in_flight", "Requests currently being processed")


def observe_request(
    *,
    model: str,
    source: str,
    status: str,
    input_tokens: int,
    output_tokens: int,
    cost_micros: int,
    latency_s: float,
    ttft_s: float | None,
) -> None:
    REQUESTS.labels(model, source, status).inc()
    TOKENS.labels(model, "input").inc(input_tokens)
    TOKENS.labels(model, "output").inc(output_tokens)
    COST.labels(model).inc(cost_micros)
    LATENCY.labels(model).observe(latency_s)
    if ttft_s is not None:
        TTFT.labels(model).observe(ttft_s)


def render() -> tuple[bytes, str]:
    return generate_latest(), CONTENT_TYPE_LATEST
