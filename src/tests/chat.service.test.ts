import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env';
import { Conversation } from '../models/conversation.model';
import { Message } from '../models/message.model';
import { User } from '../models/user.model';
import { listChatMessages, sendChatMessage } from '../services/chat.service';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  toResponseInputItems: vi.fn((items: unknown[]) => items),
}));

vi.mock('openai', () => {
  class APIError extends Error {
    status?: number;
    code?: string;
  }
  class APIConnectionError extends APIError {}
  class APIConnectionTimeoutError extends APIConnectionError {}

  class MockOpenAI {
    responses = { create: mocks.create };
  }

  return {
    default: MockOpenAI,
    APIError,
    APIConnectionError,
    APIConnectionTimeoutError,
  };
});

vi.mock('openai/lib/responses/ResponseInputItems', () => ({
  toResponseInputItems: mocks.toResponseInputItems,
}));

let replSet: MongoMemoryReplSet;
let userId: string;
let otherUserId: string;

const openAiReply = (text: string) => ({
  id: 'resp_test',
  status: 'completed',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
  output_text: text,
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
});

describe('chat.service', () => {
  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await Promise.all([
      Conversation.deleteMany({}),
      Message.deleteMany({}),
      User.deleteMany({}),
    ]);

    env.AI_PROVIDER = 'openai';
    env.AI_API_KEY = 'test-openai-key';
    env.AI_MODEL = 'test-model';

    const user = await User.create({
      email: 'chatter@example.com',
      passwordHash: 'hash',
      publicId: 'pub-chatter-1',
      displayName: 'Chatter',
      role: 'user',
      status: 'active',
    });
    const other = await User.create({
      email: 'other@example.com',
      passwordHash: 'hash',
      publicId: 'pub-other-1',
      displayName: 'Other',
      role: 'user',
      status: 'active',
    });
    userId = user._id.toString();
    otherUserId = other._id.toString();

    mocks.create.mockResolvedValue(openAiReply('Hello! How can I help?'));
  });

  it('creates a conversation, calls OpenAI, and stores both messages', async () => {
    const result = await sendChatMessage(userId, { message: 'How do I earn?' });

    expect(result.reply).toBe('Hello! How can I help?');
    expect(result.conversationId).toMatch(/^[0-9a-f]{24}$/);

    expect(mocks.create).toHaveBeenCalledTimes(1);
    const callArgs = mocks.create.mock.calls[0][0];
    expect(callArgs.model).toBe('test-model');
    expect(callArgs.instructions).toContain('EarnBridge');
    // The SDK mutates the input array with response output items, so
    // assert on the request items sent before that happened.
    expect(callArgs.input.slice(0, 1)).toEqual([
      { role: 'user', content: 'How do I earn?' },
    ]);

    const messages = await Message.find({
      conversation: result.conversationId,
    }).sort({ createdAt: 1 });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('How do I earn?');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('Hello! How can I help?');
    expect(messages[1].usage).toMatchObject({ totalTokens: 15 });

    const conversation = await Conversation.findById(result.conversationId);
    expect(conversation?.lastMessageAt).toBeInstanceOf(Date);
  });

  it('includes recent history in the OpenAI input on follow-up messages', async () => {
    const first = await sendChatMessage(userId, {
      message: 'What is the offerwall?',
    });

    mocks.create.mockResolvedValue(openAiReply('It is a list of offers.'));
    await sendChatMessage(userId, {
      conversationId: first.conversationId,
      message: 'And how do I get paid?',
    });

    const secondCallArgs = mocks.create.mock.calls[1][0];
    expect(secondCallArgs.input.slice(0, 3)).toEqual([
      { role: 'user', content: 'What is the offerwall?' },
      { role: 'assistant', content: 'Hello! How can I help?' },
      { role: 'user', content: 'And how do I get paid?' },
    ]);
  });

  it('orders history deterministically when messages share a timestamp', async () => {
    const first = await sendChatMessage(userId, { message: 'First question' });

    const sameTime = new Date('2024-01-01T00:00:00.000Z');
    await Message.updateMany(
      { conversation: first.conversationId },
      { $set: { createdAt: sameTime } }
    );

    mocks.create.mockResolvedValue(openAiReply('Second answer'));
    await sendChatMessage(userId, {
      conversationId: first.conversationId,
      message: 'Second question',
    });

    const secondCallArgs = mocks.create.mock.calls[1][0];
    expect(secondCallArgs.input.slice(0, 3)).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'Hello! How can I help?' },
      { role: 'user', content: 'Second question' },
    ]);
  });

  it('reuses an existing open conversation for the same user', async () => {
    const first = await sendChatMessage(userId, { message: 'Hi' });
    const second = await sendChatMessage(userId, {
      conversationId: first.conversationId,
      message: 'Again',
    });

    expect(second.conversationId).toBe(first.conversationId);
    expect(await Conversation.countDocuments({ user: userId })).toBe(1);
  });

  it('rejects a conversation owned by another user', async () => {
    const first = await sendChatMessage(userId, { message: 'Hi' });

    await expect(
      sendChatMessage(otherUserId, {
        conversationId: first.conversationId,
        message: 'Hello?',
      })
    ).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
  });

  it('rejects an unknown conversation ID', async () => {
    await expect(
      sendChatMessage(userId, {
        conversationId: new mongoose.Types.ObjectId().toString(),
        message: 'Hi',
      })
    ).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
  });

  it('validates the message input', async () => {
    await expect(sendChatMessage(userId, { message: '   ' })).rejects.toThrow();
    await expect(
      sendChatMessage(userId, { message: 'x'.repeat(2001) })
    ).rejects.toThrow();
    await expect(
      sendChatMessage(userId, { message: 'Hi', extra: 'field' })
    ).rejects.toThrow();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('maps provider failures to a retryable error and stores nothing', async () => {
    mocks.create.mockRejectedValue(new Error('socket hangup'));

    await expect(
      sendChatMessage(userId, { message: 'Hi' })
    ).rejects.toMatchObject({
      statusCode: 500,
      code: 'AI_REQUEST_FAILED',
    });

    expect(await Message.countDocuments({})).toBe(0);
  });

  it('returns the refusal text when the model refuses', async () => {
    mocks.create.mockResolvedValue({
      id: 'resp_refusal',
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [
            { type: 'refusal', refusal: 'I cannot help with that request.' },
          ],
        },
      ],
      output_text: '',
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });

    const result = await sendChatMessage(userId, { message: 'Do something bad' });

    expect(result.reply).toBe('I cannot help with that request.');
    const saved = await Message.findOne({ role: 'assistant' });
    expect(saved?.content).toBe('I cannot help with that request.');
  });

  it('uses a safe fallback when the response has no text or refusal', async () => {
    mocks.create.mockResolvedValue({
      id: 'resp_empty',
      status: 'completed',
      output: [],
      output_text: '',
      usage: { input_tokens: 10, output_tokens: 0, total_tokens: 10 },
    });

    const result = await sendChatMessage(userId, { message: 'Hi' });

    expect(result.reply).toBe(
      'Sorry, I could not generate a response. Please try again.'
    );
  });

  it('maps incomplete OpenAI responses to a retryable error', async () => {
    mocks.create.mockResolvedValue({
      ...openAiReply(''),
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    });

    await expect(
      sendChatMessage(userId, { message: 'Hi' })
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'AI_RESPONSE_INCOMPLETE',
    });
    expect(await Message.countDocuments({})).toBe(0);
  });

  it('fails with a configuration error when AI_API_KEY is missing', async () => {
    env.AI_API_KEY = undefined;

    await expect(
      sendChatMessage(userId, { message: 'Hi' })
    ).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('lists messages with cursor pagination, newest first', async () => {
    const { conversationId } = await sendChatMessage(userId, {
      message: 'First',
    });
    await sendChatMessage(userId, {
      conversationId,
      message: 'Second',
    });
    await sendChatMessage(userId, {
      conversationId,
      message: 'Third',
    });

    const page1 = await listChatMessages(userId, {
      conversationId,
      limit: 4,
    });
    expect(page1.messages).toHaveLength(4);
    expect(page1.messages[0].content).toBe('Hello! How can I help?');
    expect(page1.nextCursor).toBeDefined();

    const page2 = await listChatMessages(userId, {
      conversationId,
      limit: 4,
      cursor: page1.nextCursor,
    });
    expect(page2.messages).toHaveLength(2);
    expect(page2.nextCursor).toBeUndefined();
    expect(
      page1.messages.every((m) =>
        page2.messages.every((n) => n.id !== m.id)
      )
    ).toBe(true);
  });

  it('rejects listing messages for another user\'s conversation', async () => {
    const { conversationId } = await sendChatMessage(userId, {
      message: 'Hi',
    });

    await expect(
      listChatMessages(otherUserId, { conversationId })
    ).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
  });
});
