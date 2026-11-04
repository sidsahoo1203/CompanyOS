import "server-only";
import { env } from "./env";
import { logEvent } from "./log";
export type Email = { to: string; subject: string; text: string; html: string };
const entities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => entities[c]);
// Builds a plain transactional message with one action link. Names are
// user-editable, so they are escaped and length-bounded.
export function actionEmail(
  to: string,
  name: string,
  subject: string,
  intro: string,
  action: string,
  url: string,
  outro: string,
): Email {
  const greeting = "Hi " + name.slice(0, 80) + ",";
  return {
    to,
    subject,
    text: [greeting, "", intro, "", action + ": " + url, "", outro].join("\n"),
    html:
      '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1f2933">' +
      "<p>" +
      escapeHtml(greeting) +
      "</p><p>" +
      escapeHtml(intro) +
      '</p><p><a href="' +
      escapeHtml(url) +
      '" style="display:inline-block;padding:10px 18px;background:#1f4f8b;color:#fff;border-radius:6px;text-decoration:none">' +
      escapeHtml(action) +
      '</a></p><p style="color:#52606d;font-size:13px">' +
      escapeHtml(outro) +
      "</p></div>",
  };
}
// Sends through Resend in production. Local mode has no email provider: the
// message (including its link) is printed to this machine's terminal only.
export async function sendEmail(message: Email) {
  const config = env();
  if (config.APP_MODE !== "production") {
    logEvent("info", "email.local_preview", {
      subject: message.subject,
      body: message.text,
    });
    return;
  }
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + config.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    logEvent("error", "email.send_failed", { subject: message.subject });
    throw new Error("Email could not be sent. Try again shortly.");
  }
  if (!response.ok) {
    logEvent("error", "email.send_failed", {
      subject: message.subject,
      status: response.status,
    });
    throw new Error("Email could not be sent. Try again shortly.");
  }
}
