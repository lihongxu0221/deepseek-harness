/**
 * Desktop-update plugin, node half. The empty apply exists so the plugin
 * appears in the host cordis.yml / Loader; the browser half ships the
 * Settings row through exports["./client"].
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
