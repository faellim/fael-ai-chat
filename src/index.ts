
/**
 * Fael AI Chat
 * Cloudflare Workers AI with server-validated model selection.
 */
import { Env, ChatMessage } from "./types";

const MODELS = {
  llama: "@cf/meta/llama-3.1-8b-instruct-fp8",
  glm: "@cf/zai-org/glm-4.7-flash",
  gemma: "@cf/google/gemma-4-26b-a4b-it",
} as const;

type ModelKey = keyof typeof MODELS;

const DEFAULT_MODEL: ModelKey = "llama";

const SYSTEM_PROMPT =
  "You are Fael AI, a helpful and friendly assistant. " +
  "Respond in Brazilian Portuguese by default, unless the user asks for another language. " +
  "Be accurate, clear, and honest about uncertainty.";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "POST" },
        });
      }

      return handleChatRequest(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleChatRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const body = (await request.json()) as {
      messages?: ChatMessage[];
      model?: string;
    };

    if (!Array.isArray(body.messages)) {
      return Response.json(
        { error: "A valid messages array is required." },
        { status: 400 },
      );
    }

    // Only accept user and assistant messages from the client.
    // The system prompt is controlled by the server.
    const messages: ChatMessage[] = body.messages
      .filter(
        (message) =>
          message &&
          (message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string",
      )
      .slice(-40);

    messages.unshift({
      role: "system",
      content: SYSTEM_PROMPT,
    });

    // The client sends a short model key, never an arbitrary model ID.
    const requestedModel = body.model;
    const modelKey: ModelKey =
      typeof requestedModel === "string" &&
      Object.prototype.hasOwnProperty.call(MODELS, requestedModel)
        ? (requestedModel as ModelKey)
        : DEFAULT_MODEL;

    const modelId = MODELS[modelKey];

    const inputs = {
      messages,
      max_tokens: 1024,
      stream: true,
    } satisfies AiTextGenerationInput & { stream: true };

    const stream = await env.AI.run<typeof modelId>(modelId, inputs);

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Error processing chat request:", error);

    return Response.json(
      { error: "Failed to process request. Check the model and free quota." },
      { status: 500 },
    );
  }
}
