import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../app.js";
import type { ApiConfig } from "../config.js";
import type { Mailer } from "./mailer.js";
import { createNotificationService, NotificationError, type NotificationService } from "./service.js";
import { buildEmail, cleanText, escapeHtml } from "./templates.js";

const REQUESTER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECIPIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STRANGER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REQUEST_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SECRET_MESSAGE = "Mon message privé que personne d’autre ne doit lire.";
const SECRET_PHONE = "+22670123456";

const config = {
  url: "https://supabase.example.test",
  secretKey: "sb_secret_test",
  publishableKey: "sb_publishable_test",
  siteUrl: "https://lsnb.example.test",
};

type Row = { status: string; request_kind: string; opportunity_title: string | null };

function setup(row: Partial<Row> = {}, options: { claim?: unknown[]; failMail?: boolean; names?: [string, string] } = {}) {
  const sent: Parameters<Mailer["send"]>[0][] = [];
  const calls: { method: string; url: string }[] = [];
  const mailer: Mailer = {
    async send(message) {
      if (options.failMail) throw new Error("smtp down");
      sent.push(message);
    },
  };
  const [requesterName, recipientName] = options.names ?? ["Awa", "Issa"];

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

    if (url.endsWith("/auth/v1/user")) {
      const token = new Headers(init?.headers).get("authorization");
      const ids: Record<string, string> = { "Bearer requester": REQUESTER, "Bearer recipient": RECIPIENT, "Bearer stranger": STRANGER };
      const id = token ? ids[token] : undefined;
      return id ? json({ id }) : json({ message: "invalid" }, 401);
    }
    if (url.includes("/rest/v1/connection_requests")) {
      return json([{
        id: REQUEST_ID, requester_id: REQUESTER, recipient_id: RECIPIENT,
        request_kind: "contact", status: "pending", opportunity_title: null,
        // Present in the fake database on purpose: a regression that starts templating them must fail the tests.
        message: SECRET_MESSAGE, shared_phone: SECRET_PHONE, shared_email: "prive@example.test", ...row,
      }]);
    }
    if (url.includes("/rest/v1/request_notifications")) {
      return method === "POST" ? json(options.claim ?? [{ request_id: REQUEST_ID }]) : new Response(null, { status: 204 });
    }
    if (url.includes("/rest/v1/profiles")) {
      return json([
        { id: REQUESTER, first_name: requesterName, last_name: "Sanou" },
        { id: RECIPIENT, first_name: recipientName, last_name: "Traoré" },
      ]);
    }
    if (url.includes("/rest/v1/profile_contacts")) {
      return json([{ email: url.includes(RECIPIENT) ? "issa@example.test" : "awa@example.test" }]);
    }
    return json({}, 404);
  }) as typeof fetch;

  return { service: createNotificationService(config, mailer, fetchImpl), sent, calls };
}

test("a new request e-mails the recipient with a link, never with the message", async () => {
  const { service, sent } = setup();
  assert.equal(await service.notify("created", REQUEST_ID, "requester"), "sent");
  assert.equal(sent.length, 1);
  const mail = sent[0]!;
  assert.equal(mail.to, "issa@example.test");
  assert.match(mail.text, /Awa Sanou vous a écrit/);
  assert.ok(mail.text.includes("https://lsnb.example.test/espace/demandes"));
  assert.ok(mail.html.includes('href="https://lsnb.example.test/espace/demandes"'));
  assert.equal(mail.text.includes(SECRET_MESSAGE) || mail.html.includes(SECRET_MESSAGE), false);
});

test("the e-mail mentions the offer and escapes member-written text", async () => {
  const { service, sent } = setup(
    { opportunity_title: "Bourse <img src=x onerror=alert(1)> 2027" },
    { names: ["<b>Awa</b>", "Issa"] },
  );
  await service.notify("created", REQUEST_ID, "requester");
  const mail = sent[0]!;
  assert.match(mail.subject, /votre offre/);
  assert.equal(mail.html.includes("<img"), false);
  assert.equal(mail.html.includes("<b>Awa</b>"), false);
  assert.ok(mail.html.includes("&lt;img src=x onerror=alert(1)&gt;"));
});

test("mentoring requests have their own wording", async () => {
  const { service, sent } = setup({ request_kind: "mentoring" });
  await service.notify("created", REQUEST_ID, "requester");
  assert.match(sent[0]!.subject, /mentorat/);
});

test("an acceptance e-mails the requester and carries no contact detail", async () => {
  const { service, sent, calls } = setup({ status: "accepted" });
  assert.equal(await service.notify("accepted", REQUEST_ID, "recipient"), "sent");
  const mail = sent[0]!;
  assert.equal(mail.to, "awa@example.test");
  assert.match(mail.subject, /Issa Traoré a accepté votre demande/);
  assert.ok(mail.text.includes("/espace/demandes"));
  // The shared contact is never even read by the API, let alone sent.
  assert.equal(calls.some((call) => call.url.includes("shared_")), false);
  for (const secret of [SECRET_PHONE, "prive@example.test", SECRET_MESSAGE]) {
    assert.equal(mail.text.includes(secret) || mail.html.includes(secret), false, secret);
  }
});

test("only the author of the event can trigger it, and nobody can probe other requests", async () => {
  for (const [event, token, status] of [
    ["created", "recipient", "pending"],
    ["created", "stranger", "pending"],
    ["accepted", "requester", "accepted"],
    ["accepted", "stranger", "accepted"],
  ] as const) {
    const { service, sent } = setup({ status });
    await assert.rejects(service.notify(event, REQUEST_ID, token), (error) =>
      error instanceof NotificationError && error.statusCode === 404);
    assert.equal(sent.length, 0);
  }
});

test("rejects an invalid session and a request in the wrong state", async () => {
  const bad = setup();
  await assert.rejects(bad.service.notify("created", REQUEST_ID, "forged"), (error) =>
    error instanceof NotificationError && error.statusCode === 401);

  const declined = setup({ status: "declined" });
  await assert.rejects(declined.service.notify("accepted", REQUEST_ID, "recipient"), (error) =>
    error instanceof NotificationError && error.statusCode === 409);
  const answered = setup({ status: "accepted" });
  await assert.rejects(answered.service.notify("created", REQUEST_ID, "requester"), (error) =>
    error instanceof NotificationError && error.statusCode === 409);
  assert.equal(bad.sent.length + declined.sent.length + answered.sent.length, 0);
});

test("never sends the same notification twice", async () => {
  const { service, sent } = setup({}, { claim: [] });
  assert.equal(await service.notify("created", REQUEST_ID, "requester"), "already_sent");
  assert.equal(sent.length, 0);
});

test("a failed delivery releases the claim so it can be retried", async () => {
  const { service, calls } = setup({}, { failMail: true });
  await assert.rejects(service.notify("created", REQUEST_ID, "requester"), (error) =>
    error instanceof NotificationError && error.statusCode === 502 && !error.message.includes("smtp"));
  assert.ok(calls.some((call) => call.method === "DELETE" && call.url.includes("request_notifications")));
});

test("the route needs a configured service and a bearer token", async (context) => {
  const base: ApiConfig = {
    host: "127.0.0.1", port: 4000, logLevel: "silent", allowedOrigins: new Set(["http://localhost:5173"]),
  };
  const url = `/api/v1/notifications/requests/${REQUEST_ID}/created`;

  const unconfigured = await buildApp({ config: base, logger: false });
  context.after(() => unconfigured.close());
  assert.equal((await unconfigured.inject({ method: "POST", url })).statusCode, 503);

  const calls: unknown[][] = [];
  const stub: NotificationService = {
    async notify(...args) {
      calls.push(args);
      if (args[2] === "expired") throw new NotificationError(401, "Session invalide ou expirée.");
      return "sent";
    },
  };
  const app = await buildApp({ config: base, logger: false, notificationService: stub });
  context.after(() => app.close());

  assert.equal((await app.inject({ method: "POST", url })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/notifications/requests/not-a-uuid/created" })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: `/api/v1/notifications/requests/${REQUEST_ID}/deleted` })).statusCode, 400);
  assert.equal((await app.inject({ method: "GET", url })).statusCode, 404);

  const ok = await app.inject({ method: "POST", url, headers: { authorization: "Bearer abc.def" } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json(), { status: "sent" });
  assert.equal(ok.headers["cache-control"], "no-store");
  assert.deepEqual(calls, [["created", REQUEST_ID, "abc.def"]]);

  const expired = await app.inject({ method: "POST", url, headers: { authorization: "Bearer expired" } });
  assert.equal(expired.statusCode, 401);
});

test("templates strip control characters and escape HTML", () => {
  assert.equal(cleanText("Awa\r\nBcc: evil@example.test", 80), "Awa Bcc: evil@example.test");
  assert.equal(cleanText("x".repeat(200), 10).length, 10);
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  const mail = buildEmail({ event: "created", kind: "contact", opportunityTitle: null, personName: "Awa\nSanou", link: "https://x.test" });
  assert.equal(mail.subject.includes("\n"), false);
});
