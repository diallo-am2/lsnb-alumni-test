import nodemailer from "nodemailer";
import type { SmtpConfig } from "../config.js";
import type { EmailContent } from "./templates.js";

export type Mailer = {
  send(message: EmailContent & { to: string }): Promise<void>;
};

export function createSmtpMailer(config: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // 465 is implicit TLS; the usual relay port 587 upgrades with STARTTLS.
    secure: config.port === 465,
    requireTLS: config.port !== 465,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return {
    async send(message) {
      await transport.sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}
