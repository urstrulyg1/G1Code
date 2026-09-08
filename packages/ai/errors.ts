export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class AuthenticationError extends ProviderError {
  constructor(
    message = "Experiential Labs authentication failed. Check your API key.",
  ) {
    super(message, 401, false, "invalid_key");
    this.name = "AuthenticationError";
  }
}

export class RateLimitError extends ProviderError {
  constructor(message = "Experiential Labs request rate limit exceeded.") {
    super(message, 429, true, "rate_limit");
    this.name = "RateLimitError";
  }
}

export class CapabilityError extends ProviderError {
  constructor(model: string, capability: string) {
    super(
      `Model ${model} does not support ${capability}.`,
      400,
      false,
      "unsupported_capability",
    );
    this.name = "CapabilityError";
  }
}

export class NetworkError extends ProviderError {
  constructor(message: string) {
    super(`Network error: ${message}`, undefined, true, "network_error");
    this.name = "NetworkError";
  }
}

export function formatUserFriendlyError(
  error: unknown,
  model?: string,
): {
  title: string;
  message: string;
  action: string;
  retryable: boolean;
} {
  if (
    error instanceof AuthenticationError ||
    (error instanceof ProviderError && error.status === 401)
  ) {
    return {
      title: "Experiential Labs Authentication Failed",
      message: "Your API key may be invalid or revoked.",
      action: "Please configure your API key in Settings → AI Providers.",
      retryable: false,
    };
  }

  if (
    error instanceof RateLimitError ||
    (error instanceof ProviderError && error.status === 429)
  ) {
    return {
      title: "Experiential Labs Request Rate Limited",
      message: `Model ${model || "service"} has reached its temporary request limit.`,
      action: "Wait a moment and retry, or select a different available model.",
      retryable: true,
    };
  }

  if (error instanceof CapabilityError) {
    return {
      title: "Model Capability Limitation",
      message: error.message,
      action: "Switch to a model with tool calling support or use Chat mode.",
      retryable: false,
    };
  }

  if (error instanceof ProviderError && error.status && error.status >= 500) {
    return {
      title: "Experiential Labs Gateway Error",
      message: `The upstream provider returned server error (${error.status}).`,
      action: "The gateway may be experiencing temporary load. Retry shortly.",
      retryable: true,
    };
  }

  const rawMsg = error instanceof Error ? error.message : String(error);
  return {
    title: "Experiential Labs Request Failed",
    message: rawMsg.length > 200 ? rawMsg.slice(0, 200) + "..." : rawMsg,
    action: "Check your network connection or verify provider settings.",
    retryable: error instanceof ProviderError ? error.retryable : false,
  };
}
