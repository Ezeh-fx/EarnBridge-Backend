import { Document, model, Schema, Types } from 'mongoose';

export type ConversationStatus = 'open' | 'closed';

export interface IConversation {
  user: Types.ObjectId;
  status: ConversationStatus;
  lastMessageAt?: Date;
  ticketId?: Types.ObjectId;
}

export interface ConversationDocument extends IConversation, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = new Schema<ConversationDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    lastMessageAt: { type: Date },
    ticketId: { type: Schema.Types.ObjectId, ref: 'SupportTicket' },
  },
  { timestamps: true },
);

conversationSchema.index({ user: 1, createdAt: -1 });

export const Conversation = model<ConversationDocument>('Conversation', conversationSchema);
