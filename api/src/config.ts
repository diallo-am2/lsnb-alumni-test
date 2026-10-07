const DEFAULT_PORT = 4000;
const DEFAULT_ORIGIN = "http://localhost:5173";

export type SmtpConfig = { host: string; port: number; user: string; pass: string; from: string };

// E-mail notifications for the request inbox. Enabled only when every value is set.
export type NotificationConfig = {
  url: string;
  secretKey: string;
  // Public key: used to ask the auth service who a session token belongs to.
  publishableKey: string;
  siteUrl: string;
  smtp: SmtpConfig;
};

export type ApiConfig = {
  host: string;
  port: number;
  logLevel: string;
  allowedOrigins: ReadonlySet<string>;
  highlightStorage?: { url: string; secretKey: string };
  notifications?: NotificationConfig;
};

function parsePort(value: string | undefined) {
  const port = Number.parseInt(value ?? "", 10);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : DEFAULT_PORT;
}

function parseOrigins(value: string | undefined) {
  const origins = (value ?? DEFAULT_ORIGIN)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set(origins);
}

function loadNotifications(environment: NodeJS.ProcessEnv, url?: string, secretKey?: string) {
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY?.trim();
  const siteUrl = environment.SITE_URL?.trim().replace(/\/+$/, "");
  const host = environment.SMTP_HOST?.trim();
  const user = environment.SMTP_USER?.trim();
  const pass = environment.SMTP_PASS?.trim();
  const from = environment.MAIL_FROM?.trim();
  if (!url || !secretKey || !publishableKey || !siteUrl || !host || !user || !pass || !from) return undefined;
  const port = Number.parseInt(environment.SMTP_PORT ?? "", 10);
  return {
    url,
    secretKey,
    publishableKey,
    siteUrl,
    smtp: { host, port: Number.isInteger(port) && port > 0 && port <= 65_535 ? port : 587, user, pass, from },
  } satisfies NotificationConfig;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const url = environment.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const secretKey = environment.SUPABASE_SECRET_KEY?.trim();
  const notifications = loadNotifications(environment, url, secretKey);
  return {
    host: environment.API_HOST?.trim() || "0.0.0.0",
    port: parsePort(environment.PORT),
    logLevel: environment.LOG_LEVEL?.trim() || "info",
    allowedOrigins: parseOrigins(environment.FRONTEND_ORIGINS),
    ...(url && secretKey ? { highlightStorage: { url, secretKey } } : {}),
    ...(notifications ? { notifications } : {}),
  };
}
