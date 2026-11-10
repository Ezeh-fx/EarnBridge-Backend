import { Document, model, Schema, Types } from 'mongoose';

export type SupportTicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface ISupportTicket {
  user: Types.ObjectId;
  conversation?: Types.ObjectId;
  subject: string;
  summary?: string;
  status: SupportTicketStatus;
  assignedTo?: Types.ObjectId;
  resolvedAt?: Date;
}

export interface SupportTicketDocument extends ISupportTicket, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const supportTicketSchema = new Schema<SupportTicketDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    conversation: { type: Schema.Types.ObjectId, ref: 'Conversation' },
    subject: { type: String, required: true, trim: true },
    summary: { type: String },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'resolved', 'closed'],
      default: 'open',
    },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
  },
  { timestamps: true },
);

supportTicketSchema.index({ user: 1, createdAt: -1 });
supportTicketSchema.index({ status: 1, createdAt: -1 });

export const SupportTicket = model<SupportTicketDocument>('SupportTicket', supportTicketSchema);
