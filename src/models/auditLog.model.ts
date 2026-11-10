import { Document, model, Schema, Types } from 'mongoose';

export interface IAuditLog {
  actor?: Types.ObjectId;
  action: string;
  targetType?: string;
  targetId?: string;
  summary?: string;
  ip?: string;
}

export interface AuditLogDocument extends IAuditLog, Document {
  _id: Types.ObjectId;
  createdAt: Date;
}

const auditLogSchema = new Schema<AuditLogDocument>(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    targetType: { type: String },
    targetId: { type: String },
    summary: { type: String },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

export const AuditLog = model<AuditLogDocument>('AuditLog', auditLogSchema);
