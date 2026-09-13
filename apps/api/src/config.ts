import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

import { normalizeEmailAddress } from "./auth/email.js";

loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const developmentCorsOrigins = [
  "http://127.0.0.1:4173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://localhost:5173"
];

const weakProductionSecretPatterns = [
  /change[-_ ]?me/i,
  /dev(?:elopment)?[-_ ]?only/i,
  /example/i,
  /replace/i
];

const booleanString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const environmentSchema = z.object({
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1_000).default(10),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60 * 60 * 1_000)
    .default(60_000),
  CORS_ORIGINS: z.string().optional(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  EMAIL_FROM: z.string().min(1).optional(),
  EMAIL_VERIFICATION_TTL_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(30),
  HOST: z.string().min(1).default("127.0.0.1"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  MIGRATIONS_DATABASE_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional()
  ),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  REQUEST_BODY_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .min(4_096)
    .max(5 * 1024 * 1024)
    .default(1_500_000),
  BETA_ALLOWED_EMAILS: z.string().optional(),
  REGISTRATION_MODE: z.string().optional(),
  RESEND_API_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional()
  ),
  SESSION_COOKIE_SAME_SITE: z.enum(["strict", "lax", "none"]).default("strict"),
  SESSION_SECRET: z.string().min(32).max(512),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24 * 7),
  TRUST_PROXY: booleanString.default("false"),
  WEB_APP_URL: z.string().min(1).optional()
});

type ParsedEnvironment = z.infer<typeof environmentSchema>;
export type RegistrationMode = "closed" | "open";

export type AppConfig = Omit<
  ParsedEnvironment,
  "BETA_ALLOWED_EMAILS" | "CORS_ORIGINS" | "REGISTRATION_MODE"
> & {
  BETA_ALLOWED_EMAILS: string[];
  CORS_ORIGINS: string[];
  REGISTRATION_MODE: RegistrationMode;
};

function parseRegistrationConfig(
  modeValue: string | undefined,
  allowlistValue: string | undefined
): Pick<AppConfig, "BETA_ALLOWED_EMAILS" | "REGISTRATION_MODE"> {
  const registrationMode: RegistrationMode =
    modeValue === "open" ? "open" : "closed";

  if (!allowlistValue?.trim()) {
    return { BETA_ALLOWED_EMAILS: [], REGISTRATION_MODE: registrationMode };
  }

  const normalizedEntries = allowlistValue.split(",").map(normalizeEmailAddress);
  if (normalizedEntries.some((entry) => entry === null)) {
    return { BETA_ALLOWED_EMAILS: [], REGISTRATION_MODE: registrationMode };
  }

  return {
    BETA_ALLOWED_EMAILS: [...new Set(normalizedEntries as string[])],
    REGISTRATION_MODE: registrationMode
  };
}

function validateDatabaseUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol");
  }
}

function parseCorsOrigins(
  value: string | undefined,
  nodeEnvironment: AppConfig["NODE_ENV"]
): string[] {
  if (value === undefined) {
    if (nodeEnvironment === "production") {
      throw new Error(
        "CORS_ORIGINS must be set in production (use an empty value for same-origin only)"
      );
    }
    return developmentCorsOrigins;
  }

  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const uniqueOrigins = [...new Set(origins)];

  for (const origin of uniqueOrigins) {
    if (origin === "*") {
      throw new Error("CORS_ORIGINS cannot contain a wildcard");
    }
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("CORS_ORIGINS must contain valid HTTP(S) origins");
    }
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.origin !== origin ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      throw new Error(
        "CORS_ORIGINS entries must be exact HTTP(S) origins without paths or credentials"
      );
    }
  }

  return uniqueOrigins;
}

function validateSessionSecret(secret: string, nodeEnvironment: AppConfig["NODE_ENV"]): void {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 UTF-8 bytes");
  }
  if (
    nodeEnvironment === "production" &&
    weakProductionSecretPatterns.some((pattern) => pattern.test(secret))
  ) {
    throw new Error("SESSION_SECRET must be a randomly generated production secret");
  }
}

const emailMailboxSchema = z.string().email().max(254);

function validateEmailFrom(value: string): string {
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("EMAIL_FROM must be a valid email sender without control characters");
  }

  if (emailMailboxSchema.safeParse(value).success) {
    return value;
  }

  const displayNameMatch = /^([\p{L}\p{N} ._'’-]+) <([^<>]+)>$/u.exec(value);
  if (
    !displayNameMatch ||
    !displayNameMatch[1]?.trim() ||
    !emailMailboxSchema.safeParse(displayNameMatch[2]).success
  ) {
    throw new Error("EMAIL_FROM must be a valid email sender mailbox");
  }

  return value;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname);
}

function normalizeWebAppUrl(value: string, nodeEnvironment: AppConfig["NODE_ENV"]): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("WEB_APP_URL must be a valid HTTP(S) URL");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    value.includes("?") ||
    value.includes("#") ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname !== "/"
  ) {
    throw new Error(
      "WEB_APP_URL must be an HTTP(S) origin without credentials, path, query, or fragment"
    );
  }
  if (nodeEnvironment === "production" && parsed.protocol !== "https:") {
    throw new Error("WEB_APP_URL must use HTTPS in production");
  }
  if (parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname)) {
    throw new Error("WEB_APP_URL may use HTTP only for localhost or loopback in non-production");
  }

  return parsed.origin;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid environment configuration: ${details}`);
  }

  try {
    validateDatabaseUrl(result.data.DATABASE_URL);
    if (result.data.MIGRATIONS_DATABASE_URL) {
      validateDatabaseUrl(result.data.MIGRATIONS_DATABASE_URL);
    }
    if (result.data.EMAIL_FROM) {
      validateEmailFrom(result.data.EMAIL_FROM);
    }
    validateSessionSecret(result.data.SESSION_SECRET, result.data.NODE_ENV);
    if (result.data.SESSION_COOKIE_SAME_SITE === "none" && result.data.NODE_ENV !== "production") {
      throw new Error("SESSION_COOKIE_SAME_SITE=none requires NODE_ENV=production");
    }
    if (result.data.NODE_ENV === "production") {
      const missing = (["EMAIL_FROM", "RESEND_API_KEY", "WEB_APP_URL"] as const).filter(
        (name) => !result.data[name]
      );
      if (missing.length > 0) {
        throw new Error(`Production email verification requires ${missing.join(", ")}`);
      }
    }
    return {
      ...result.data,
      ...parseRegistrationConfig(
        result.data.REGISTRATION_MODE,
        result.data.BETA_ALLOWED_EMAILS
      ),
      CORS_ORIGINS: parseCorsOrigins(result.data.CORS_ORIGINS, result.data.NODE_ENV),
      WEB_APP_URL: result.data.WEB_APP_URL
        ? normalizeWebAppUrl(result.data.WEB_APP_URL, result.data.NODE_ENV)
        : undefined
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid configuration";
    throw new Error(`Invalid environment configuration: ${message}`);
  }
}
