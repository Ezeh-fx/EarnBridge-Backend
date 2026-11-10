import { Document, model, Schema, Types } from 'mongoose';

export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageStatus = 'ok' | 'error';

export interface IMessage {
  conversation: Types.ObjectId;
  user: Types.ObjectId;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface MessageDocument extends IMessage, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<MessageDocument>(
  {
    conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true },
    status: { type: String, enum: ['ok', 'error'], default: 'ok' },
    usage: {
      promptTokens: { type: Number },
      completionTokens: { type: Number },
      totalTokens: { type: Number },
    },
  },
  { timestamps: true },
);

messageSchema.index({ conversation: 1, createdAt: 1 });
messageSchema.index({ user: 1, createdAt: -1 });

export const Message = model<MessageDocument>('Message', messageSchema);
