import pino, { type Logger, type LoggerOptions } from "pino";

const isDev = process.env.NODE_ENV !== "production";

const options: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "subchats" },
  redact: {
    paths: [
      "*.email",
      "*.passwordHash",
      "*.OPENAI_API_KEY",
      "req.headers.cookie",
      "req.headers.authorization",
      "res.headers",
      "*.selectedText",
      "*.highlightText",
      "*.highlightContext",
      "*.clientHighlightContext",
    ],
    censor: "[redacted]",
  },
};

if (isDev) {
  options.transport = {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
    },
  };
}

export const log: Logger = pino(options);

export function withRequestId(requestId: string): Logger {
  return log.child({ requestId });
}

export default log;
