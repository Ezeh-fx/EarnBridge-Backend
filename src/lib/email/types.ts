export interface EmailAttachment {
  filename: string;
  content: Buffer;
  cid: string;
  contentType?: string;
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  attachments?: EmailAttachment[];
}

export interface EmailDeliveryMetadata {
  messageId: string;
  acceptedCount: number;
  rejectedCount: number;
}

export interface EmailProvider {
  sendEmail(message: EmailMessage): Promise<EmailDeliveryMetadata>;
  verifyConnection(): Promise<void>;
  close?(): Promise<void>;
}
