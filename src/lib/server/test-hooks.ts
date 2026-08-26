import { error } from '@sveltejs/kit';

/**
 * The runtime half of the test-hook boundary. The build-time half is
 * `__TEST_HOOKS__` (vite.config.ts): a plain production build folds it
 * to false, every /test/* handler tree-shakes away, and this module
 * goes with them. This guard only exists in builds that compiled the
 * hooks in - `vite dev`, and builds run with TEST_HOOKS=1 - where it
 * still requires the runtime variable before a hook will answer.
 *
 * The 404 message doubles as the deploy-gate's marker: it can only
 * appear in a bundle that compiled the hooks in, so the gate refuses
 * to deploy any worker that contains it (hooks/deploy_gate.py).
 */
export function requireTestHooks(env: { TEST_HOOKS?: string }): void {
	if (env.TEST_HOOKS !== '1') error(404, 'BINDER-TEST-HOOKS-COMPILED-IN');
}
