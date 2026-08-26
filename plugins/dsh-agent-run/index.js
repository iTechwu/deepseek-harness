/**
 * dsh-agent-run bundle entry.
 *
 * This is a STANDALONE BIN bundle, not an agent-preset patch: it contributes no
 * system-prompt section or tools to a hosting profile. The behaviour lives in
 * the `dsh-agent-run` bin (`bin/agent-run.js`), which boots this bundle's own
 * cordis.yml headlessly to run one OpenMontage pipeline stage.
 *
 * The `apply` is a no-op so the module is a valid, mountable Cordis plugin even
 * if a deployment's DSH_PLUGIN_SPECS happens to list it — it just does nothing
 * to the hosting profile.
 *
 * @module @dofe/dsh-agent-run
 */

export const name = 'dsh-agent-run'

export function apply() {
  // Intentionally empty: this bundle is a standalone bin, not a profile patch.
}
