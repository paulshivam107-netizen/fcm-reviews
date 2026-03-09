export interface AppLogger {
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

function write(level: "debug" | "info" | "warn" | "error", scope: string, message: string, metadata?: Record<string, unknown>) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    metadata: metadata ?? {},
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export function createLogger(scope: string): AppLogger {
  return {
    debug(message, metadata) {
      write("debug", scope, message, metadata);
    },
    info(message, metadata) {
      write("info", scope, message, metadata);
    },
    warn(message, metadata) {
      write("warn", scope, message, metadata);
    },
    error(message, metadata) {
      write("error", scope, message, metadata);
    },
  };
}
