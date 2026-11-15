import { Types, type QueryFilter } from 'mongoose';
import { z } from 'zod';
import {
  CHAT_HISTORY_LIMIT,
  CHAT_LIST_MAX_LIMIT,
  CHAT_MAX_MESSAGE_LENGTH,
} from '../config/constants';
import { env } from '../config/env';
import {
  createChatCompletion,
  type AiResponseInputItem,
} from '../lib/ai';
import { AppError } from '../lib/errors';
import { Conversation } from '../models/conversation.model';
import { Message, type MessageDocument } from '../models/message.model';
import type { MessageRole } from '../models/message.model';

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/);

const sendMessageInputSchema = z
  .object({
    conversationId: objectIdSchema.optional(),
    message: z.string().trim().min(1).max(CHAT_MAX_MESSAGE_LENGTH),
  })
  .strict();

const listMessagesInputSchema = z
  .object({
    conversationId: objectIdSchema,
    limit: z.coerce.number().int().min(1).max(CHAT_LIST_MAX_LIMIT).default(20),
    cursor: z.string().min(1).max(200).optional(),
  })
  .strict();

const SUPPORT_CHAT_INSTRUCTIONS = `You are the EarnBridge support assistant. EarnBridge is a rewards app where users earn money by completing offers on the offerwall, rewards are credited to their wallet, and they can request withdrawals once they meet the minimum amount.

Rules you must always follow:
- Answer general questions about how Earnbridge works: earning rewards, the wallet, transaction history, and withdrawals.
- You only explain and advise. You cannot change balances, approve withdrawals, process payouts, or modify accounts. If asked to do any of these, explain that a human support agent handles it.
- Never ask for or accept passwords, card numbers, API keys, or other sensitive data.
- Never promise specific earnings amounts, payment dates, or withdrawal approval. Processing times vary.
- If you are unsure or the question needs account-specific action, tell the user our human support team can help them.
- Keep answers short, clear, and friendly. Use plain language.`;

export interface SendChatMessageResult {
  conversationId: string;
  reply: string;
  createdAt: Date;
}

export interface ChatMessageItem {
  id: string;
  role: MessageRole;
  content: string;
  status: 'ok' | 'error';
  createdAt: Date;
}

export interface ListChatMessagesResult {
  messages: ChatMessageItem[];
  nextCursor?: string;
}

const toInputItem = (
  role: MessageRole,
  content: string
): AiResponseInputItem | null => {
  if (role === 'user') {
    return { role: 'user', content };
  }
  if (role === 'assistant') {
    return { role: 'assistant', content };
  }
  return null;
};

const encodeCursor = (createdAt: Date, id: Types.ObjectId): string =>
  Buffer.from(
    JSON.stringify({ t: createdAt.getTime(), id: id.toString() })
  ).toString('base64url');

const decodeCursor = (
  cursor: string
): { createdAt: Date; id: Types.ObjectId } => {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8')
    ) as { t?: unknown; id?: unknown };

    if (
      typeof parsed.t !== 'number' ||
      !Number.isFinite(parsed.t) ||
      typeof parsed.id !== 'string' ||
      !objectIdSchema.safeParse(parsed.id).success
    ) {
      throw new Error('bad cursor');
    }

    return { createdAt: new Date(parsed.t), id: new Types.ObjectId(parsed.id) };
  } catch {
    throw AppError.badRequest('INVALID_CURSOR', 'Invalid pagination cursor');
  }
};

export const sendChatMessage = async (
  userId: string,
  rawInput: unknown
): Promise<SendChatMessageResult> => {
  const input = sendMessageInputSchema.parse(rawInput);
  const userObjectId = new Types.ObjectId(userId);

  const conversation = input.conversationId
    ? await Conversation.findOne({
        _id: input.conversationId,
        user: userObjectId,
        status: 'open',
      })
    : await Conversation.create({ user: userObjectId });

  if (!conversation) {
    throw AppError.notFound(
      'CONVERSATION_NOT_FOUND',
      'Conversation not found'
    );
  }

  const history = await Message.find({
    conversation: conversation._id,
    user: userObjectId,
  })
    .sort({ createdAt: -1 })
    .limit(CHAT_HISTORY_LIMIT)
    .select('role content')
    .lean();

  const inputItems: AiResponseInputItem[] = [];
  for (const message of [...history].reverse()) {
    const item = toInputItem(message.role, message.content);
    if (item) {
      inputItems.push(item);
    }
  }
  inputItems.push({ role: 'user', content: input.message });

  const result = await createChatCompletion({
    instructions: SUPPORT_CHAT_INSTRUCTIONS,
    input: inputItems,
    model: env.AI_MODEL,
  });

  const saved = await Message.insertMany([
    {
      conversation: conversation._id,
      user: userObjectId,
      role: 'user',
      content: input.message,
    },
    {
      conversation: conversation._id,
      user: userObjectId,
      role: 'assistant',
      content: result.text,
      usage: result.usage,
    },
  ]);

  const assistantMessage = saved[1];
  await Conversation.updateOne(
    { _id: conversation._id },
    { $set: { lastMessageAt: new Date() } }
  );

  return {
    conversationId: conversation._id.toString(),
    reply: result.text,
    createdAt: assistantMessage.createdAt,
  };
};

export const listChatMessages = async (
  userId: string,
  rawInput: unknown
): Promise<ListChatMessagesResult> => {
  const input = listMessagesInputSchema.parse(rawInput);
  const userObjectId = new Types.ObjectId(userId);

  const conversation = await Conversation.findOne({
    _id: input.conversationId,
    user: userObjectId,
  }).select('_id');

  if (!conversation) {
    throw AppError.notFound(
      'CONVERSATION_NOT_FOUND',
      'Conversation not found'
    );
  }

  const filter: QueryFilter<MessageDocument> = {
    conversation: conversation._id,
    user: userObjectId,
  };

  if (input.cursor) {
    const cursor = decodeCursor(input.cursor);
    filter.$or = [
      { createdAt: { $lt: cursor.createdAt } },
      {
        createdAt: cursor.createdAt,
        _id: { $lt: cursor.id },
      },
    ];
  }

  const messages = await Message.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(input.limit + 1)
    .select('role content status createdAt')
    .lean();

  const hasMore = messages.length > input.limit;
  const page = hasMore ? messages.slice(0, input.limit) : messages;
  const last = page[page.length - 1];

  return {
    messages: page.map((message) => ({
      id: message._id.toString(),
      role: message.role,
      content: message.content,
      status: message.status,
      createdAt: message.createdAt,
    })),
    ...(hasMore && last
      ? { nextCursor: encodeCursor(last.createdAt, last._id) }
      : {}),
  };
};
