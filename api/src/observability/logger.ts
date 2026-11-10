export type LogFields = Record<string, string | number | boolean>;

export interface Logger {
  info(fields: LogFields): void;
  error(fields: LogFields): void;
}

function write(level: "info" | "error", fields: LogFields): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    ...fields,
  };
  const serialized = JSON.stringify(entry);
  if (level === "error") {
    console.error(serialized);
  } else {
    console.log(serialized);
  }
}

export const logger: Logger = {
  info: (fields) => write("info", fields),
  error: (fields) => write("error", fields),
};
