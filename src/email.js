import { config } from "./config.js";

const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";
const BATCH_SIZE = 100; // Resend's limit per batch request

// Sends up to 100 emails per request. Each email has a single recipient, so
// nobody ever sees anyone else's address.
async function resendTransport(emails) {
  const response = await fetch(RESEND_BATCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.email.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      emails.map(({ to, subject, text, html }) => ({
        from: config.email.from,
        to: [to],
        subject,
        text,
        html,
      }))
    ),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend answered ${response.status}: ${detail.slice(0, 300)}`);
  }
}

// Without a Resend key (local development), emails are only logged.
async function logTransport(emails) {
  if (config.env === "test") return;
  for (const email of emails) {
    console.log(`[email not sent: RESEND_API_KEY is not set] to=${email.to} subject="${email.subject}"`);
  }
}

let testTransport = null;

// Tests replace the transport to capture emails.
export function setEmailTransport(transport) {
  testTransport = transport;
}

export async function sendEmails(emails) {
  const transport =
    testTransport ?? (config.email.resendApiKey ? resendTransport : logTransport);
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    await transport(emails.slice(i, i + BATCH_SIZE));
  }
}
