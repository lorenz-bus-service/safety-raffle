import type { Config } from './config.ts';

/** Posts short plain-text notices to Slack and Teams, whichever have a webhook address configured. */
export interface Notifier {
  /** Returns a description of each channel that could not be reached; never throws. */
  post(text: string): Promise<string[]>;
}

export function createNotifier(notify: Config['notify'], fetchImpl: typeof fetch = fetch): Notifier {
  const channels: { name: string; url: string; body: (text: string) => unknown }[] = [];
  if (notify.slackWebhookUrl) {
    channels.push({ name: 'Slack', url: notify.slackWebhookUrl, body: (text) => ({ text }) });
  }
  if (notify.teamsWebhookUrl) {
    // Teams "Workflows" webhooks expect an Adaptive Card wrapped in a message.
    channels.push({
      name: 'Teams',
      url: notify.teamsWebhookUrl,
      body: (text) => ({
        type: 'message',
        attachments: [
          {
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: {
              $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
              type: 'AdaptiveCard',
              version: '1.4',
              body: [{ type: 'TextBlock', text, wrap: true }],
            },
          },
        ],
      }),
    });
  }

  return {
    async post(text) {
      const problems: string[] = [];
      for (const channel of channels) {
        try {
          const response = await fetchImpl(channel.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(channel.body(text)),
            signal: AbortSignal.timeout(30_000),
          });
          if (!response.ok) problems.push(`${channel.name} returned ${response.status}`);
        } catch (error) {
          problems.push(`${channel.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return problems;
    },
  };
}
