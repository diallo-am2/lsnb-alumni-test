import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyServerOptions } from "fastify";
import { loadConfig, type ApiConfig } from "./config.js";
import { createHighlightStore } from "./highlights/store.js";
import type { HighlightStore } from "./highlights/types.js";
import { currentWeekStart } from "./highlights/week.js";
import { createSmtpMailer } from "./notifications/mailer.js";
import { createNotificationService, NotificationError, type NotificationService } from "./notifications/service.js";

type BuildAppOptions = {
  config?: ApiConfig;
  logger?: FastifyServerOptions["logger"];
  highlightStore?: Pick<HighlightStore, "current">;
  notificationService?: NotificationService;
  now?: () => Date;
};

const healthSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["status", "service"],
      properties: {
        status: { type: "string" },
        service: { type: "string" },
      },
    },
  },
} as const;

export async function buildApp(options: BuildAppOptions = {}) {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    logger: options.logger ?? { level: config.logLevel },
    trustProxy: true,
  });

  await app.register(helmet);
  await app.register(cors, {
    credentials: true,
    origin(origin, callback) {
      const isAllowed = !origin || config.allowedOrigins.has(origin);
      callback(null, isAllowed);
    },
  });

  app.get("/health", { schema: healthSchema }, async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return { status: "ok", service: "lsnb-alumni-api" };
  });

  app.get("/api/v1", async () => ({
    name: "LSNB Alumni API",
    version: "v1",
  }));

  const highlightStore = options.highlightStore ?? (config.highlightStorage
    ? createHighlightStore(config.highlightStorage)
    : undefined);

  app.get("/api/v1/highlights/current", async (request, reply) => {
    // Texts are persisted in Postgres. No browser/CDN cache can prolong a withdrawn profile.
    reply.header("cache-control", "no-store");
    if (!highlightStore) return { highlight: null };
    try {
      return { highlight: await highlightStore.current(currentWeekStart(options.now?.())) };
    } catch {
      request.log.error("Unable to read the current Highlight edition");
      return reply.code(503).send({ error: "Les Highlights sont momentanément indisponibles." });
    }
  });

  const notificationService = options.notificationService ?? (config.notifications
    ? createNotificationService(config.notifications, createSmtpMailer(config.notifications.smtp))
    : undefined);

  // The browser calls this right after it saved a request (or accepted one). The
  // session token proves who is asking; the e-mail itself carries only a link.
  app.post<{ Params: { requestId: string; event: "created" | "accepted" } }>(
    "/api/v1/notifications/requests/:requestId/:event",
    {
      schema: {
        params: {
          type: "object",
          required: ["requestId", "event"],
          properties: {
            requestId: { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" },
            event: { type: "string", enum: ["created", "accepted"] },
          },
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      if (!notificationService) {
        return reply.code(503).send({ error: "Les notifications par e-mail ne sont pas configurées." });
      }
      const match = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? "");
      if (!match?.[1]) return reply.code(401).send({ error: "Connexion requise." });
      try {
        const status = await notificationService.notify(request.params.event, request.params.requestId, match[1]);
        return { status };
      } catch (error) {
        if (error instanceof NotificationError) return reply.code(error.statusCode).send({ error: error.message });
        request.log.error("Unexpected failure while sending a request notification");
        return reply.code(502).send({ error: "La notification n’a pas pu être envoyée." });
      }
    },
  );

  return app;
}
