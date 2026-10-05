import {Console, Effect, FileSystem} from 'effect';
import type {RuntimeConfig} from '@threadnote/workspace/config';
import {SystemInfo} from '@threadnote/platform/system';
import {getThreadnoteVersion} from '@threadnote/workspace/runtime-version';
import {
  agentIntegrationDoctorChecks,
  installCodexCloudAgentIntegration,
  readAgentIntegrationRegistry,
} from '../agent_integration/index.js';
import {
  configuredTeamChecks,
  credentialFreeGitRemote,
  cursorCloudMemoryRoot,
  planCursorCloudBootstrap,
  type CursorCloudMemoryScope,
} from '../cursor/cloud.js';
import {listShareConflicts, readTeamsFile, runShareInit, runShareSync, shareTeamAccess} from '../share/index.js';
import {withSharedRepositoryLock} from '../effect/share/lock.js';
import {captureConsoleWithoutProgress} from '../effect/console.js';
import {uriSegment} from '../mcp/server/common.js';
import {
  CodexCloudError,
  DEFAULT_CODEX_CLOUD_IDENTITY,
  assertCodexCloudIdentity,
  normalizeCodexCloudShares,
  persistCodexCloudProfile,
  readCodexCloudProfile,
  sameCloudIdentity,
} from './profile.js';

export function codexCloudRuntimeConfig(
  config: RuntimeConfig,
  options: {readonly agentId?: string; readonly user?: string},
): RuntimeConfig {
  const saved = (source: RuntimeConfig['userSource']) =>
    source === 'environment' || source === 'cursor-cloud-profile' || source === 'codex-cloud-profile';
  return {
    ...config,
    agentId: options.agentId ?? (saved(config.agentIdSource) ? config.agentId : DEFAULT_CODEX_CLOUD_IDENTITY),
    agentIdSource: 'codex-cloud-command',
    user: options.user ?? (saved(config.userSource) ? config.user : DEFAULT_CODEX_CLOUD_IDENTITY),
    userSource: 'codex-cloud-command',
  };
}

export const requireCodexCloudProfile = Effect.fn('codexCloud.requireProfile')(function* (config: RuntimeConfig) {
  const profile = yield* readCodexCloudProfile(config.agentContextHome);
  if (!profile)
    return yield* CodexCloudError.make({
      message: 'Run threadnote cloud codex bootstrap --remote <credential-free-url> --team <name> first.',
    });
  if (!sameCloudIdentity(profile, config))
    return yield* CodexCloudError.make({
      message:
        'Runtime identity conflicts with the Codex Cloud profile. Remove conflicting THREADNOTE identity overrides or use a separate THREADNOTE_HOME.',
    });
  return profile;
});

export const codexCloudMemoryScope = Effect.fn('codexCloud.memoryScope')(function* (
  config: RuntimeConfig,
  team?: string,
  localReads = false,
) {
  const profile = yield* requireCodexCloudProfile(config);
  const selected = team === undefined ? profile.teams : normalizeCodexCloudShares([team]);
  if (selected.some(value => !profile.teams.includes(value)))
    return yield* CodexCloudError.make({
      message: `Share "${team}" is outside the configured Codex Cloud share set. Bootstrap it explicitly first.`,
    });
  const teamsFile = yield* readTeamsFile(config);
  for (const name of selected) {
    if (!teamsFile.teams[name] || shareTeamAccess(teamsFile.teams[name]) !== 'read-write')
      return yield* CodexCloudError.make({
        message: `Codex Cloud share "${name}" is missing or not writable. Rerun bootstrap with its existing remote or review threadnote share set-access.`,
      });
    yield* Effect.try({
      try: () => credentialFreeGitRemote(teamsFile.teams[name].remote, 'Codex Cloud'),
      catch: cause =>
        CodexCloudError.make({
          cause,
          message: `Codex Cloud share "${name}" has an invalid remote. Configure a credential-free URL with threadnote share set-url; supply authentication through the environment's Git credential provider.`,
        }),
    });
  }
  return {
    mode: 'shared-read-write',
    label: 'Codex Cloud',
    shares: selected.map(team => ({root: cursorCloudMemoryRoot(config.user, team), team})),
    ...(localReads ? {localReadRoots: [`threadnote://user/${uriSegment(config.user)}/memories/handoffs`]} : {}),
  } satisfies CursorCloudMemoryScope;
});

const codexCloudShareIngestCheck = Effect.fn('codexCloud.shareIngestCheck')(function* (
  config: RuntimeConfig,
  team: string,
) {
  const conflicts = yield* listShareConflicts(config, {team});
  return {
    name: `share ingest ${team}`,
    status: conflicts.length === 0 ? ('ok' as const) : ('fail' as const),
    detail:
      conflicts.length === 0
        ? 'no pending memory conflicts'
        : `${conflicts.length} pending memory conflict(s); inspect with threadnote share conflicts --team ${team}`,
  };
});

export const runCodexCloudBootstrap = Effect.fn('codexCloud.bootstrap')(function* (
  config: RuntimeConfig,
  options: {readonly remote: string; readonly team?: string; readonly dryRun: boolean},
) {
  yield* assertCodexCloudIdentity(config);
  const existing = yield* readCodexCloudProfile(config.agentContextHome);
  const team = normalizeCodexCloudShares([options.team ?? DEFAULT_CODEX_CLOUD_IDENTITY])[0];
  const selected = normalizeCodexCloudShares([...(existing?.teams ?? []), team]);
  // Validate configuration and preview the managed artifacts before creating a share.
  const plan = planCursorCloudBootstrap(yield* readTeamsFile(config), options.remote, team, 'Codex Cloud');
  const preview = yield* captureConsoleWithoutProgress(installCodexCloudAgentIntegration(config, true));
  if (options.dryRun) {
    yield* Console.log(`Would ${plan.action} Codex Cloud share "${team}"; selected shares: ${selected.join(', ')}.`);
    if (preview.output) yield* Console.log(preview.output);
    yield* Console.log('Dry run complete; no profile, artifacts, Git share, or remote was changed.');
    return;
  }
  yield* withSharedRepositoryLock(
    config,
    Effect.gen(function* () {
      const current = yield* readCodexCloudProfile(config.agentContextHome);
      const teams = normalizeCodexCloudShares([...(current?.teams ?? []), team]);
      const currentPlan = planCursorCloudBootstrap(yield* readTeamsFile(config), options.remote, team, 'Codex Cloud');
      if (currentPlan.action === 'initialize') {
        yield* runShareInit(config, currentPlan.remote, {push: true, readOnly: false, setDefault: false, team});
      } else {
        yield* Console.log(`Codex Cloud share "${team}" is already configured read-write; reusing it.`);
      }
      yield* runShareSync(config, {push: true, team});
      const ingest = yield* codexCloudShareIngestCheck(config, team);
      if (ingest.status === 'fail') return yield* CodexCloudError.make({message: ingest.detail});
      yield* installCodexCloudAgentIntegration(config, false);
      yield* persistCodexCloudProfile(config, teams);
    }),
  );
  yield* Console.log(`Codex Cloud memory root: ${cursorCloudMemoryRoot(config.user, team)}/`);
});

export const runCodexCloudVerify = Effect.fn('codexCloud.verify')(function* (config: RuntimeConfig, json: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const profile = yield* readCodexCloudProfile(config.agentContextHome);
  const registry = yield* readAgentIntegrationRegistry(config);
  const checks = [
    {
      name: 'saved identity',
      status: profile && sameCloudIdentity(profile, config) ? ('ok' as const) : ('fail' as const),
      detail: profile ? `${profile.user}/${profile.agentId}` : 'missing; run bootstrap',
    },
    {
      name: 'CLI installation',
      status:
        registry?.hosts.codex?.mcp.transport === 'cli' && registry.hosts.codex.status === 'current'
          ? ('ok' as const)
          : ('fail' as const),
      detail: 'managed codex-cloud-personal artifacts',
    },
  ];
  for (const check of yield* agentIntegrationDoctorChecks(config)) {
    if (check.name.startsWith('codex ')) checks.push({...check, status: check.status === 'ok' ? 'ok' : 'fail'});
  }
  const teamsFile = yield* readTeamsFile(config);
  for (const team of profile?.teams ?? []) {
    const configured = teamsFile.teams[team];
    if (!configured) checks.push({name: `share ${team}`, status: 'fail', detail: 'missing; rerun bootstrap'});
    else {
      checks.push(
        ...(yield* configuredTeamChecks(fs, configured, team).pipe(
          Effect.map(values =>
            values.map(check => ({...check, status: check.status === 'ok' ? ('ok' as const) : ('fail' as const)})),
          ),
        )),
      );
      checks.push(yield* codexCloudShareIngestCheck(config, team));
    }
  }
  const receipt = {
    checks,
    identity: {account: config.account, agentId: config.agentId, user: config.user},
    provider: 'codex-cloud',
    runtime: {platform: (yield* SystemInfo).platform, version: yield* getThreadnoteVersion()},
    shares: profile?.teams ?? [],
    status: checks.every(check => check.status === 'ok') ? 'ok' : 'fail',
    transport: 'cli',
    version: 1,
  };
  if (json) yield* Console.log(JSON.stringify(receipt));
  else for (const check of checks) yield* Console.log(`${check.status.toUpperCase()} ${check.name}: ${check.detail}`);
  if (receipt.status === 'fail')
    return yield* CodexCloudError.make({
      message:
        'Codex Cloud verification failed. Repair the reported configuration or artifacts before publishing the environment.',
    });
});

export const runCodexCloudStart = Effect.fn('codexCloud.start')(function* (config: RuntimeConfig, json: boolean) {
  const profile = yield* requireCodexCloudProfile(config);
  yield* codexCloudMemoryScope(config);
  const refreshed = yield* captureConsoleWithoutProgress(
    Effect.forEach(profile.teams, team => runShareSync(config, {push: false, autoCommit: false, team}), {
      discard: true,
    }),
  );
  if (refreshed.output) yield* Console.error(refreshed.output);
  yield* runCodexCloudVerify(config, json);
});
