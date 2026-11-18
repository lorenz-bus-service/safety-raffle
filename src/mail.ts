import nodemailer from 'nodemailer';
import type { Config } from './config.ts';

export interface Attachment {
  filename: string;
  content: Uint8Array;
  contentType: string;
}

export interface Message {
  to: string[];
  subject: string;
  html: string;
  attachments?: Attachment[];
}

export interface Mailer {
  send(message: Message): Promise<void>;
}

const base64 = (data: Uint8Array): string => Buffer.from(data).toString('base64');

async function expectOk(response: Response, service: string): Promise<void> {
  if (response.ok) return;
  const body = (await response.text()).slice(0, 300);
  throw new Error(`${service} returned ${response.status}: ${body}`);
}

function smtpMailer(email: Config['email']): Mailer {
  const transport = nodemailer.createTransport({
    host: email.smtp.host,
    port: email.smtp.port,
    secure: email.smtp.secure,
    auth: email.smtp.username ? { user: email.smtp.username, pass: email.smtp.password } : undefined,
  });
  return {
    async send(message) {
      await transport.sendMail({
        from: email.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        attachments: (message.attachments ?? []).map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content),
          contentType: a.contentType,
        })),
      });
    },
  };
}

/** Sends through Microsoft 365 as the EMAIL_FROM mailbox, using an app registration with the Mail.Send permission. */
function graphMailer(email: Config['email'], fetchImpl: typeof fetch): Mailer {
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && Date.now() < token.expiresAt) return token.value;
    const response = await fetchImpl(
      `https://login.microsoftonline.com/${encodeURIComponent(email.graph.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: email.graph.clientId,
          client_secret: email.graph.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
        }),
      },
    );
    await expectOk(response, 'Microsoft sign-in');
    const body = (await response.json()) as { access_token: string; expires_in: number };
    token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
    return token.value;
  }

  return {
    async send(message) {
      const response = await fetchImpl(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email.from)}/sendMail`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              subject: message.subject,
              body: { contentType: 'HTML', content: message.html },
              toRecipients: message.to.map((address) => ({ emailAddress: { address } })),
              attachments: (message.attachments ?? []).map((a) => ({
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: a.filename,
                contentType: a.contentType,
                contentBytes: base64(a.content),
              })),
            },
            saveToSentItems: true,
          }),
        },
      );
      await expectOk(response, 'Microsoft Graph');
    },
  };
}

function resendMailer(email: Config['email'], fetchImpl: typeof fetch): Mailer {
  return {
    async send(message) {
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${email.resend.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: email.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          attachments: (message.attachments ?? []).map((a) => ({ filename: a.filename, content: base64(a.content) })),
        }),
      });
      await expectOk(response, 'Resend');
    },
  };
}

/** The mailer for the configured transport, or null when email is switched off. */
export function createMailer(email: Config['email'], fetchImpl: typeof fetch = fetch): Mailer | null {
  switch (email.transport) {
    case 'smtp':
      return smtpMailer(email);
    case 'graph':
      return graphMailer(email, fetchImpl);
    case 'resend':
      return resendMailer(email, fetchImpl);
    case 'none':
      return null;
  }
}
