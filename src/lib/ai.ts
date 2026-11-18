import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from 'openai';
import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from './errors.js';

export type AiFunctionTool = OpenAI.Responses.FunctionTool;
export type AiResponseInputItem = OpenAI.Responses.ResponseInputItem;

export type AiToolExecutor = (
  toolName: string,
  argumentsJson: string
) => Promise<string>;

export interface AiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AiChatResult {
  text: string;
  responseId?: string;
  usage: AiUsage;
}

const DEFAULT_MODEL = 'gpt-4.1-mini';
const MAX_TOOL_ITERATIONS = 5;
const REQUEST_TIMEOUT_MS = 30_000;

const ASSISTANT_UNAVAILABLE_MESSAGE =
  'The assistant is temporarily unavailable. Please try again.';

let client: OpenAI | undefined;

const getClient = (): OpenAI => {
  if (env.AI_PROVIDER !== undefined && env.AI_PROVIDER !== 'openai') {
    throw AppError.internal(
      'AI_PROVIDER_UNSUPPORTED',
      'AI chat is not configured'
    );
  }

  if (!env.AI_API_KEY) {
    throw AppError.internal('AI_NOT_CONFIGURED', 'AI chat is not configured');
  }

  client ??= new OpenAI({
    apiKey: env.AI_API_KEY,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
  });
  return client;
};

const unavailable = (code: string): AppError =>
  AppError.serviceUnavailable(code, ASSISTANT_UNAVAILABLE_MESSAGE);

const EMPTY_REPLY_FALLBACK =
  'Sorry, I could not generate a response. Please try again.';

const extractReplyText = (response: OpenAI.Responses.Response): string => {
  if (response.output_text.trim().length > 0) {
    return response.output_text;
  }

  const refusal = response.output
    .filter(
      (item): item is OpenAI.Responses.ResponseOutputMessage =>
        item.type === 'message'
    )
    .flatMap((message) => message.content)
    .find(
      (part): part is OpenAI.Responses.ResponseOutputRefusal =>
        part.type === 'refusal'
    );

  return refusal?.refusal ?? EMPTY_REPLY_FALLBACK;
};

const toAiError = (err: unknown): AppError => {
  if (err instanceof AppError) {
    return err;
  }

  if (err instanceof APIConnectionTimeoutError) {
    logger.error({ err: err.message }, 'OpenAI request timed out');
    return unavailable('AI_TIMEOUT');
  }

  if (err instanceof APIConnectionError) {
    logger.error({ err: err.message }, 'OpenAI connection failed');
    return unavailable('AI_UNAVAILABLE');
  }

  if (err instanceof APIError) {
    logger.error(
      { status: err.status, code: err.code, message: err.message },
      'OpenAI request failed'
    );

    if (err.status === 429 || (err.status !== undefined && err.status >= 500)) {
      return unavailable('AI_PROVIDER_UNAVAILABLE');
    }

    // 4xx from the provider means our request or configuration is wrong.
    return AppError.internal('AI_REQUEST_FAILED', ASSISTANT_UNAVAILABLE_MESSAGE);
  }

  logger.error({ err }, 'Unexpected AI provider error');
  return AppError.internal('AI_REQUEST_FAILED', ASSISTANT_UNAVAILABLE_MESSAGE);
};

export interface CreateChatCompletionParams {
  instructions: string;
  input: AiResponseInputItem[];
  tools?: AiFunctionTool[];
  executeTool?: AiToolExecutor;
  model?: string;
}

export const createChatCompletion = async (
  params: CreateChatCompletionParams
): Promise<AiChatResult> => {
  const openai = getClient();
  const model = params.model ?? env.AI_MODEL ?? DEFAULT_MODEL;
  const tools = params.tools ?? [];
  const input: OpenAI.Responses.ResponseInput = [...params.input];

  if (tools.length > 0 && !params.executeTool) {
    throw AppError.internal(
      'AI_TOOL_EXECUTOR_MISSING',
      'AI tool executor is not configured'
    );
  }

  try {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
      const response = await openai.responses.create({
        model,
        instructions: params.instructions,
        input,
        ...(tools.length > 0 ? { tools } : {}),
      });

      input.push(...toResponseInputItems(response.output));

      const functionCalls = response.output.filter(
        (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
          item.type === 'function_call'
      );

      if (functionCalls.length === 0) {
        if (response.status !== 'completed') {
          logger.error(
            {
              status: response.status,
              reason: response.incomplete_details?.reason,
              responseId: response.id,
            },
            'OpenAI response did not complete'
          );
          throw unavailable('AI_RESPONSE_INCOMPLETE');
        }

        return {
          text: extractReplyText(response),
          responseId: response.id,
          usage: {
            promptTokens: response.usage?.input_tokens,
            completionTokens: response.usage?.output_tokens,
            totalTokens: response.usage?.total_tokens,
          },
        };
      }

      for (const call of functionCalls) {
        let output: string;
        try {
          output = await params.executeTool!(call.name, call.arguments);
        } catch (toolErr) {
          logger.warn(
            { tool: call.name, err: toolErr },
            'AI tool execution failed'
          );
          output = JSON.stringify({ error: 'Tool execution failed' });
        }

        input.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output,
        });
      }
    }

    logger.error('AI tool call loop exceeded maximum iterations');
    throw unavailable('AI_TOOL_LOOP_EXCEEDED');
  } catch (err) {
    throw toAiError(err);
  }
};
