/**
 * OpenCLI tool driver for the dsh web profile.
 *
 * Registers a model-facing `opencli` tool that invokes the OpenCLI CLI on the
 * harness host. OpenCLI drives a real Google Chrome session and exposes 100+
 * site adapters, so this one tool lets the model browse, log in, and extract
 * data through adapters (`opencli twitter search ...`) or the browser driver
 * (`opencli browser navigate --url ...`).
 *
 * This bundle is loaded as an out-of-tree plugin via `dsh plugin --profile web
 * add`, so its module resolution is isolated: it must NOT import harness
 * internal packages (e.g. `@deepseek-ai/dsh-tools`). The tool is therefore
 * registered directly through `ctx.tools.register` with a hand-built JSON
 * Schema definition.
 *
 * Prerequisites on the harness image: Chrome + OpenCLI installed and on PATH
 * (the CI harness image bakes them in, see deepseek-harness/Dockerfile), plus
 * Node >= 20 (already present).
 *
 * @module @dofe/dsh-opencli
 */

/** Stable Cordis plugin id (matches the cordis.patch.yml row id). */
export const name = "dsh-opencli-tools";

/** Services the opencli tool needs. */
export const inject = ["tools", "shell"];

/** Cooperative single-command timeout budget (ms). */
const DEFAULT_TIMEOUT_MS = 60000;

/** OpenCLI output formats. */
const FORMATS = ["json", "yaml", "table", "plain", "md", "csv"];

/** Render a machine-readable JSON string compactly. */
function compactJson(value) {
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return value;
  }
}

/** Map one OpenCLI outcome into model-facing text. */
function formatOpencliOutput(value) {
  const header = value.ok
    ? `OpenCLI succeeded (exit ${value.exitCode})`
    : `OpenCLI failed${value.stderr ? ": " + value.stderr : ""} (exit ${value.exitCode})`;
  if (!value.ok) return header;
  if (value.stdout) return header + "\n" + compactJson(value.stdout);
  return header + "\n(no output)";
}

/**
 * Register the `opencli` tool for the current generation. The registration is
 * effect-scoped and unregisters on plugin dispose.
 * @param ctx - Host context carrying the tools and shell registries.
 */
export function apply(ctx) {
  return ctx.tools.register({
    name: "opencli",
    description:
      "Run an OpenCLI command and return its output. OpenCLI drives a real Google Chrome browser and 100+ site adapters. Pass the full command after `opencli`: e.g. `browser navigate --url https://example.com`, `twitter search --query opencli`, `chatgpt read`. Use -f json for structured output.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        command: {
          type: "string",
          description:
            "Full OpenCLI arguments after the `opencli` binary. Examples: `browser navigate --url https://example.com`, `twitter search --query hello`, `chatgpt read`.",
        },
        format: {
          type: "string",
          enum: [...FORMATS],
          description:
            "Optional output format appended as `-f <format>`. Defaults to json.",
        },
        timeoutMs: {
          type: "number",
          description: "Command timeout in milliseconds. Default 60000.",
        },
      },
      required: ["command"],
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean" },
          command: { type: "string" },
          exitCode: { type: "integer" },
          stdout: { type: "string" },
          stderr: { type: "string" },
        },
        required: ["ok", "command", "exitCode"],
      },
      render: (_args, value) => [
        { type: "text", text: formatOpencliOutput(value) },
      ],
    },
    timeoutMs: DEFAULT_TIMEOUT_MS,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const commandText =
        args && typeof args.command === "string" ? args.command.trim() : "";
      let command = "opencli " + commandText;
      if (args && args.format) command += " -f " + args.format;
      const timeoutMs =
        args && Number.isFinite(args.timeoutMs) && args.timeoutMs > 0
          ? args.timeoutMs
          : DEFAULT_TIMEOUT_MS;
      const result = await ctx.shell.run(
        ctx.shell.resolve({
          command,
          signal: exec.signal,
          timeoutMs,
        }),
      );
      return {
        ok: result.exitCode === 0,
        command: commandText,
        exitCode: Number.isInteger(result.exitCode) ? result.exitCode : 1,
        stdout: result.stdout.text,
        stderr: result.stderr.text,
      };
    },
  });
}
