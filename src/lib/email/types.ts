export interface EmailMessage {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
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
