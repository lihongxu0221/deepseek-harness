/**
 * Bundled default `cordis.yml` written next to a packaged JSON-RPC executable
 * when neither `$DSH_CORDIS_CONFIG` nor argv names a config.
 * Plugin entries match `python/sdk-runtime/src/deepseek_harness_runtime/runtime/cordis.yml`.
 *
 * @module @deepseek-ai/dsh-sdk-jsonrpc-demo/default-cordis-yml
 */

/**
 * Default plugin list for a packaged executable-directory `cordis.yml`.
 * Unset `DSH_SESSION_ROOT` and `DSH_CWD` keep the YAML fallbacks; the packaged
 * launcher sets those variables to the executable directory before boot.
 */
export const PACKAGED_DEFAULT_CORDIS_YML = `# Default config written next to the packaged executable when launched with
# no $DSH_CORDIS_CONFIG and no argv path. Edit this file to change the plugin
# composition. An explicit env or argv path still wins and is never created.
# Unset DSH_SESSION_ROOT and DSH_CWD fall back to this executable's directory
# on that executable-directory launch.

# Stdio JSON-RPC server entry; without it the agent has no SDK client.
- id: sdk-jsonrpc-server
  name: '@deepseek-ai/dsh-sdk-jsonrpc-server'

# Agent spine; the SDK server creates agents per sessionId.
- id: agent-core
  name: '@deepseek-ai/dsh-agent-spine-demo'
  config:
    workspaceContext:
      maxBytes: 65536

# Stock DeepSeek adapters. The adapter resolves DEEPSEEK_API_KEY through the
# credential seam and, with no provider mounted here, from the launching
# environment; DEEPSEEK_BASE_URL follows the same environment ladder. Neither
# is inlined, so this file names no secret and no route.
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek'

# JSONL persistence; $DSH_SESSION_ROOT wins over ./.sessions in the process cwd.
- id: sessions
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: !!js process.env.DSH_SESSION_ROOT ?? './.sessions'

# Persistence owns durable storage; this separate policy explicitly selects
# the request, tool-dispatch, and completed-step durability checkpoints.
- id: session-checkpoints
  name: '@deepseek-ai/dsh-session-checkpoint-policy'

# Local bash executor; $DSH_CWD wins over the process cwd.
# Managed child-process groups for the bash executor (spawn/kill/output plumbing).
- id: subprocess
  name: '@deepseek-ai/dsh-subprocess-local'

- id: bash
  name: '@deepseek-ai/dsh-bash-local'
  config:
    cwd: !!js process.env.DSH_CWD ?? process.cwd()

# Local filesystem provider for workspace instruction loading. This does not
# expose model-facing file tools by itself.
- id: fs-local
  name: '@deepseek-ai/dsh-fs-local'
  config:
    cwd: !!js process.env.DSH_CWD ?? process.cwd()

`
