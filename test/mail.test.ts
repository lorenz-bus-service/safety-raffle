import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { createMailer } from '../src/mail.ts';
import { createNotifier } from '../src/notify.ts';

function recorder(status = 200) {
  const requests: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const body = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body ?? '');
    requests.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body });
    const reply = String(url).includes('login.microsoftonline.com') ? { access_token: 'graph-token', expires_in: 3600 } : {};
    return new Response(JSON.stringify(reply), { status: String(url).includes('login.') ? 200 : status });
  }) as unknown as typeof fetch;
  return { requests, fetchImpl };
}

const message = {
  to: ['a@example.com', 'b@example.com'],
  cc: ['c@example.com'],
  subject: 'Tickets',
  html: '<p>Hello</p>',
  attachments: [{ filename: 'tickets.pdf', content: new TextEncoder().encode('PDF'), contentType: 'application/pdf' }],
};
const env = { SAMSARA_API_TOKEN: 'x', EMAIL_FROM: 'raffle@example.com' };

describe('email transports', () => {
  it('is off when the transport is none', () => {
    expect(createMailer(loadConfig({ SAMSARA_API_TOKEN: 'x' }).email)).toBeNull();
  });

  it('sends through Microsoft Graph as the sender mailbox, reusing the token', async () => {
    const { requests, fetchImpl } = recorder(202);
    const config = loadConfig({ ...env, EMAIL_TRANSPORT: 'graph', GRAPH_TENANT_ID: 'tenant', GRAPH_CLIENT_ID: 'client', GRAPH_CLIENT_SECRET: 'shh' });
    const mailer = createMailer(config.email, fetchImpl)!;
    await mailer.send(message);
    await mailer.send(message);

    expect(requests.map((r) => r.url)).toEqual([
      'https://login.microsoftonline.com/tenant/oauth2/v2.0/token',
      'https://graph.microsoft.com/v1.0/users/raffle%40example.com/sendMail',
      'https://graph.microsoft.com/v1.0/users/raffle%40example.com/sendMail',
    ]);
    expect(requests[0]!.body).toContain('grant_type=client_credentials');
    expect(requests[1]!.headers.Authorization).toBe('Bearer graph-token');
    const sent = JSON.parse(requests[1]!.body).message;
    expect(sent.toRecipients).toEqual([{ emailAddress: { address: 'a@example.com' } }, { emailAddress: { address: 'b@example.com' } }]);
    expect(sent.ccRecipients).toEqual([{ emailAddress: { address: 'c@example.com' } }]);
    expect(sent.body).toEqual({ contentType: 'HTML', content: '<p>Hello</p>' });
    expect(sent.attachments[0]).toMatchObject({ name: 'tickets.pdf', contentBytes: 'UERG' });
  });

  it('sends through Resend', async () => {
    const { requests, fetchImpl } = recorder();
    const mailer = createMailer(loadConfig({ ...env, EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_123' }).email, fetchImpl)!;
    await mailer.send(message);
    expect(requests[0]!.url).toBe('https://api.resend.com/emails');
    expect(requests[0]!.headers.Authorization).toBe('Bearer re_123');
    expect(JSON.parse(requests[0]!.body)).toMatchObject({
      from: 'raffle@example.com', to: message.to, cc: ['c@example.com'], subject: 'Tickets', attachments: [{ filename: 'tickets.pdf', content: 'UERG' }],
    });
  });

  it('raises an error the run can report when the service refuses', async () => {
    const { fetchImpl } = recorder(403);
    const mailer = createMailer(loadConfig({ ...env, EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_123' }).email, fetchImpl)!;
    await expect(mailer.send(message)).rejects.toThrow(/Resend returned 403/);
  });
});

describe('Slack and Teams notices', () => {
  it('posts to whichever webhooks are configured', async () => {
    const { requests, fetchImpl } = recorder();
    const { notify } = loadConfig({ ...env, SLACK_WEBHOOK_URL: 'https://hooks.example/slack', TEAMS_WEBHOOK_URL: 'https://hooks.example/teams' });
    expect(await createNotifier(notify, fetchImpl).post('Run failed')).toEqual([]);
    expect(JSON.parse(requests[0]!.body)).toEqual({ text: 'Run failed' });
    expect(JSON.parse(requests[1]!.body).attachments[0].content.body[0]).toMatchObject({ type: 'TextBlock', text: 'Run failed' });
  });

  it('posts nowhere when none is configured, and reports instead of throwing when one fails', async () => {
    const quiet = recorder();
    expect(await createNotifier(loadConfig(env).notify, quiet.fetchImpl).post('x')).toEqual([]);
    expect(quiet.requests).toEqual([]);
    const broken = recorder(500);
    const { notify } = loadConfig({ ...env, SLACK_WEBHOOK_URL: 'https://hooks.example/slack' });
    expect(await createNotifier(notify, broken.fetchImpl).post('x')).toEqual(['Slack returned 500']);
  });
});
