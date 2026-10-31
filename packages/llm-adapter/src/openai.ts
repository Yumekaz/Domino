import type {
  LlmGenerateRequest,
  LlmGenerateResponse,
  LlmProvider,
} from "../../core/evidence/src/types.ts";
import { HistoryError } from "../../core/history/src/errors.ts";

export interface OpenAiProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  providerName?: string;
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  jsonMode?: boolean;
}

interface ChatCompletionResponse {
  model?: unknown;
  choices?: unknown;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
  };
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly provider: string;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxTokensField: "max_tokens" | "max_completion_tokens";
  private readonly jsonMode: boolean;

  constructor(options: OpenAiProviderOptions) {
    const key = options.apiKey.trim();
    if (key.length === 0) {
      throw new HistoryError(
        "LLM_UNAVAILABLE",
        "No model credential is configured",
        {
          recoverable: true,
        },
      );
    }
    this.apiKey = key;
    this.model = options.model;
    this.provider = options.providerName ?? "openai";
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(
      /\/+$/,
      "",
    );
    this.maxTokensField = options.maxTokensField ?? "max_completion_tokens";
    this.jsonMode = options.jsonMode ?? true;
  }

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResponse> {
    const timeoutMs = Math.max(1_000, Math.min(120_000, request.timeoutMs));
    const maxTokens = Math.max(64, Math.min(8_000, request.maxOutputTokens));
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    if (request.signal !== undefined) {
      if (request.signal.aborted) {
        controller.abort();
      } else {
        request.signal.addEventListener("abort", onAbort, { once: true });
      }
    }
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          temperature: 0.1,
          ...(this.model === "gpt-6-luna"
            ? { reasoning_effort: "none", store: false }
            : {}),
          [this.maxTokensField]: maxTokens,
          ...(this.jsonMode
            ? { response_format: { type: "json_object" } }
            : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const status = response.status;
        if (status === 429) {
          throw new HistoryError(
            "LLM_RATE_LIMITED",
            "The model provider rate-limited synthesis",
            {
              recoverable: true,
              details: { status },
            },
          );
        }
        if (status === 408) {
          throw new HistoryError(
            "LLM_TIMEOUT",
            "The model provider timed out",
            {
              recoverable: true,
              details: { status },
            },
          );
        }
        throw new HistoryError(
          "LLM_UNAVAILABLE",
          "The model provider rejected or failed the request",
          { recoverable: true, details: { status } },
        );
      }
      const bodyText = await response.text();
      if (bodyText.length > 1_000_000) {
        throw new HistoryError(
          "LLM_BAD_OUTPUT",
          "The model response was unexpectedly large",
          {
            recoverable: true,
          },
        );
      }
      let body: ChatCompletionResponse;
      try {
        body = JSON.parse(bodyText) as ChatCompletionResponse;
      } catch {
        throw new HistoryError(
          "LLM_BAD_OUTPUT",
          "The model provider returned malformed JSON",
          {
            recoverable: true,
          },
        );
      }
      const content = extractContent(body);
      if (content === null || content.trim().length === 0) {
        throw new HistoryError(
          "LLM_BAD_OUTPUT",
          "The model returned no textual content",
          {
            recoverable: true,
          },
        );
      }
      return {
        text: content,
        provider: this.provider,
        model: typeof body.model === "string" ? body.model : this.model,
        ...(body.usage === undefined
          ? {}
          : {
              usage: {
                ...(typeof body.usage.prompt_tokens === "number"
                  ? { inputTokens: body.usage.prompt_tokens }
                  : {}),
                ...(typeof body.usage.completion_tokens === "number"
                  ? { outputTokens: body.usage.completion_tokens }
                  : {}),
              },
            }),
      };
    } catch (error) {
      if (error instanceof HistoryError) {
        throw error;
      }
      if (timedOut || controller.signal.aborted) {
        throw new HistoryError(
          "LLM_TIMEOUT",
          "The model request exceeded its timeout",
          {
            recoverable: true,
          },
        );
      }
      throw new HistoryError(
        "LLM_UNAVAILABLE",
        "The model provider was unreachable",
        {
          recoverable: true,
          cause: error,
        },
      );
    } finally {
      clearTimeout(timeout);
      if (request.signal !== undefined) {
        request.signal.removeEventListener("abort", onAbort);
      }
    }
  }
}

export interface OpenAiEnvOptions {
  model?: string;
  baseUrl?: string;
  providerName?: string;
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  jsonMode?: boolean;
}

export function createOpenAiProviderFromEnv(
  options: OpenAiEnvOptions = {},
): LlmProvider {
  const apiKey =
    process.env.DOMINO_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  const model = options.model ?? process.env.DOMINO_LLM_MODEL ?? "gpt-6-luna";
  return new OpenAiCompatibleProvider({
    apiKey,
    model,
    ...(options.baseUrl === undefined &&
    process.env.DOMINO_LLM_BASE_URL === undefined
      ? {}
      : { baseUrl: options.baseUrl ?? process.env.DOMINO_LLM_BASE_URL }),
    ...(options.providerName === undefined
      ? {}
      : { providerName: options.providerName }),
    ...(options.maxTokensField === undefined
      ? {}
      : { maxTokensField: options.maxTokensField }),
    ...(options.jsonMode === undefined ? {} : { jsonMode: options.jsonMode }),
  });
}

export class UnavailableLlmProvider implements LlmProvider {
  readonly provider = "unconfigured";
  readonly model = "none";

  async generate(): Promise<LlmGenerateResponse> {
    throw new HistoryError(
      "LLM_UNAVAILABLE",
      "No model provider is configured",
      {
        recoverable: true,
      },
    );
  }
}

function extractContent(body: ChatCompletionResponse): string | null {
  if (!Array.isArray(body.choices) || body.choices.length === 0) {
    return null;
  }
  const first = body.choices[0];
  if (first === null || typeof first !== "object") {
    return null;
  }
  const message = (first as Record<string, unknown>).message;
  if (message === null || typeof message !== "object") {
    return null;
  }
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (part !== null && typeof part === "object") {
          const record = part as Record<string, unknown>;
          return typeof record.text === "string" ? record.text : "";
        }
        return "";
      })
      .join("");
    return text.length > 0 ? text : null;
  }
  return null;
}
