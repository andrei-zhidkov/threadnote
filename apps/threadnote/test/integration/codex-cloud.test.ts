import {execFile} from '@threadnote/testing/node-child-process';
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from '@threadnote/testing/node-fs-promises';
import {tmpdir} from '@threadnote/testing/node-os';
import {join} from '@threadnote/testing/node-path';
import {promisify} from '@threadnote/testing/node-util';
import {describe, expect, it} from 'vitest';

const exec = promisify(execFile);
const gitIdentity = {
  GIT_AUTHOR_EMAIL: 'cloud@threadnote.local',
  GIT_AUTHOR_NAME: 'Cloud Test',
  GIT_COMMITTER_EMAIL: 'cloud@threadnote.local',
  GIT_COMMITTER_NAME: 'Cloud Test',
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'threadnote-codex-cloud-'));
  const remote = join(root, 'memory.git');
  const otherRemote = join(root, 'other.git');
  for (const path of [remote, otherRemote]) {
    await exec('git', ['init', '--bare', '--initial-branch=main', path]);
    const seed = `${path}-seed`;
    await exec('git', ['clone', path, seed]);
    await writeFile(join(seed, 'README.md'), '# Private memory fixture\n');
    await exec('git', ['-C', seed, 'add', '.']);
    await exec('git', ['-C', seed, 'commit', '-m', 'Seed memory'], {env: {...process.env, ...gitIdentity}});
    await exec('git', ['-C', seed, 'push', 'origin', 'main']);
  }
  const userHome = join(root, 'user-home');
  await mkdir(userHome);
  const home = join(root, 'home');
  const run = (args: readonly string[], targetHome = home) =>
    exec(process.execPath, ['apps/threadnote/src/standalone.ts', 'cloud', 'codex', ...args, '--home', targetHome], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...gitIdentity,
        HOME: userHome,
        NO_COLOR: '1',
        THREADNOTE_USER: undefined,
        THREADNOTE_AGENT_ID: undefined,
        THREADNOTE_ACCOUNT: undefined,
        CODEX_HOME: undefined,
      },
      maxBuffer: 2 * 1024 * 1024,
    });
  const bootstrap = (targetHome = home, team = 'personal', url = remote) =>
    run(['bootstrap', '--remote', url, '--team', team], targetHome);
  return {root, home, userHome, remote, otherRemote, run, bootstrap};
}

function parsed(stdout: string) {
  return JSON.parse(stdout) as {
    isError?: boolean;
    structuredContent?: {memoryUri?: string};
    status?: string;
    shares?: string[];
    identity?: {user: string; agentId: string};
  };
}

describe('Codex Cloud CLI integration', () => {
  it('keeps dry run inert, reuses bootstrap, persists identity, and verifies missing artifacts', async () => {
    const f = await fixture();
    try {
      await f.run(['bootstrap', '--remote', f.remote, '--team', 'personal', '--dry-run']);
      await expect(readFile(join(f.home, 'codex-cloud', 'profile.json'))).rejects.toMatchObject({code: 'ENOENT'});
      await expect(readFile(join(f.home, 'share', 'teams.json'))).rejects.toMatchObject({code: 'ENOENT'});
      await f.bootstrap();
      const profile = await readFile(join(f.home, 'codex-cloud', 'profile.json'), 'utf8');
      const teams = await readFile(join(f.home, 'share', 'teams.json'), 'utf8');
      expect((await f.bootstrap()).stdout).toContain('reusing it');
      expect(await readFile(join(f.home, 'codex-cloud', 'profile.json'), 'utf8')).toBe(profile);
      expect(await readFile(join(f.home, 'share', 'teams.json'), 'utf8')).toBe(teams);
      expect(parsed((await f.run(['verify', '--json'])).stdout)).toMatchObject({
        status: 'ok',
        identity: {user: 'codex-cloud', agentId: 'codex-cloud'},
        shares: ['personal'],
      });
      const registry = JSON.parse(await readFile(join(f.home, 'integrations', 'agents.json'), 'utf8'));
      expect(registry.hosts.codex.mcp).toMatchObject({
        artifactProfile: 'codex-cloud-personal',
        transport: 'cli',
        repair: false,
      });
      await expect(readFile(join(f.userHome, '.codex', 'config.toml'))).rejects.toMatchObject({code: 'ENOENT'});
      const skill = join(f.userHome, '.agents', 'skills', 'threadnote-context', 'SKILL.md');
      await rm(skill);
      await expect(f.run(['verify', '--json'])).rejects.toMatchObject({
        stdout: expect.stringContaining('"status":"fail"'),
        stderr: expect.stringContaining('verification failed'),
      });
      await f.bootstrap();
      expect(await readFile(skill, 'utf8')).toContain('Personal Codex Cloud');
      await expect(f.run(['bootstrap', '--remote', f.otherRemote, '--team', 'personal'])).rejects.toMatchObject({
        stderr: expect.stringContaining('different remote'),
      });
      await expect(
        f.run(['bootstrap', '--remote', f.remote, '--team', 'personal', '--user', 'other-user']),
      ).rejects.toMatchObject({stderr: expect.stringContaining('already uses user')});
      const accessConflict = JSON.parse(teams);
      accessConflict.teams.personal.access = 'read-only';
      await writeFile(join(f.home, 'share', 'teams.json'), JSON.stringify(accessConflict));
      await expect(f.bootstrap()).rejects.toMatchObject({stderr: expect.stringContaining('not read-write')});
      await writeFile(join(f.home, 'share', 'teams.json'), teams);
      await mkdir(join(f.home, 'cursor-cloud'));
      await writeFile(
        join(f.home, 'cursor-cloud', 'profile.json'),
        JSON.stringify({
          account: 'local',
          agentId: 'other-agent',
          provider: 'cursor-cloud',
          user: 'other-user',
          version: 1,
        }),
      );
      await expect(f.run(['verify', '--json'])).rejects.toMatchObject({
        stderr: expect.stringContaining('conflicting identities'),
      });
      await rm(join(f.home, 'cursor-cloud'), {recursive: true});
      await f.bootstrap(f.home, 'docs', f.otherRemote);
      expect(parsed((await f.run(['verify', '--json'])).stdout).shares).toEqual(['docs', 'personal']);
    } finally {
      await rm(f.root, {recursive: true, force: true});
    }
  }, 90_000);

  it('pushes durable memory across isolated homes, refreshes startup, and keeps handoffs local', async () => {
    const f = await fixture();
    try {
      const second = join(f.root, 'second-home');
      await f.bootstrap();
      await f.bootstrap(second);
      const stored = parsed(
        (
          await f.run([
            'remember',
            '--project',
            'fixture',
            '--topic',
            'contract',
            '--text',
            'Cloud persistence contract marker.',
            '--json',
          ])
        ).stdout,
      );
      const uri = stored.structuredContent!.memoryUri!;
      expect(uri).toContain('/user/codex-cloud/memories/shared/personal/');
      expect(parsed((await f.run(['start', '--json'], second)).stdout).status).toBe('ok');
      expect(
        (
          await f.run(
            ['recall', '--cwd', process.cwd(), '--query', 'Cloud persistence contract marker', '--project', 'fixture'],
            second,
          )
        ).stdout,
      ).toContain(uri.replace('threadnote://user/codex-cloud/', ''));
      expect((await f.run(['read', '--uri', uri], second)).stdout).toContain('Cloud persistence contract marker');
      const handoff = parsed(
        (
          await f.run([
            'remember',
            '--kind',
            'handoff',
            '--project',
            'fixture',
            '--topic',
            'local-task',
            '--text',
            'Local task handoff marker.',
            '--json',
          ])
        ).stdout,
      );
      expect((await f.run(['read', '--uri', handoff.structuredContent!.memoryUri!])).stdout).toContain(
        'Local task handoff marker',
      );
      await expect(f.run(['read', '--uri', handoff.structuredContent!.memoryUri!], second)).rejects.toBeDefined();
      const tree = await exec('git', ['--git-dir', f.remote, 'ls-tree', '-r', '--name-only', 'main']);
      expect(tree.stdout).toContain('contract.md');
      expect(tree.stdout).not.toContain('local-task');
    } finally {
      await rm(f.root, {recursive: true, force: true});
    }
  }, 90_000);

  it('enforces selected shares and replacements and surfaces rejected pushes', async () => {
    const f = await fixture();
    try {
      await f.bootstrap();
      await f.bootstrap(f.home, 'docs', f.otherRemote);
      const stored = parsed(
        (
          await f.run([
            'remember',
            '--team',
            'personal',
            '--project',
            'fixture',
            '--topic',
            'contract',
            '--text',
            'Original reviewed contract.',
            '--json',
          ])
        ).stdout,
      );
      const uri = stored.structuredContent!.memoryUri!;
      await expect(f.run(['remember', '--text', 'Ambiguous durable write.'])).rejects.toMatchObject({
        stderr: expect.stringContaining('requires team'),
      });
      await expect(
        f.run(['remember', '--team', 'docs', '--replace-uri', uri, '--text', 'Wrong share replacement.']),
      ).rejects.toMatchObject({stderr: expect.stringContaining('configured Codex Cloud share')});
      await expect(
        f.run(['remember', '--team', 'docs', '--reference', uri, '--text', 'Wrong share reference.']),
      ).rejects.toMatchObject({stderr: expect.stringContaining('selected share')});
      await expect(f.run(['read', '--uri', uri.replace('/personal/', '/unconfigured/')])).rejects.toMatchObject({
        stderr: expect.stringContaining('configured Codex Cloud share'),
      });
      await f.run([
        'remember',
        '--replace-uri',
        uri,
        '--project',
        'fixture',
        '--topic',
        'contract',
        '--text',
        'Updated reviewed contract.',
      ]);
      expect((await f.run(['read', '--uri', uri])).stdout).toContain('Updated reviewed contract');
      await expect(
        f.run([
          'remember',
          '--team',
          'docs',
          '--relation',
          JSON.stringify({type: 'references', uri}),
          '--text',
          'Wrong share relation.',
        ]),
      ).rejects.toMatchObject({stderr: expect.stringContaining('authorized memory scope')});
      await expect(f.run(['read', '--uri', 'threadnote://memory/tn_outside_scope'])).rejects.toBeDefined();
      await expect(f.run(['read', '--uri', uri, '--team', 'docs'])).rejects.toMatchObject({
        stderr: expect.stringContaining('configured Codex Cloud share'),
      });
      const tree = await exec('git', ['--git-dir', f.otherRemote, 'ls-tree', '-r', '--name-only', 'main']);
      expect(tree.stdout).not.toContain('contract.md');
      const hook = join(f.remote, 'hooks', 'pre-receive');
      await writeFile(hook, '#!/bin/sh\necho "Fixture push denied" >&2\nexit 1\n');
      await chmod(hook, 0o755);
      await expect(
        f.run(['remember', '--team', 'personal', '--topic', 'rejected', '--text', 'Rejected write marker.', '--json']),
      ).rejects.toMatchObject({
        stdout: expect.stringContaining('"isError":true'),
        stderr: expect.stringContaining('remember failed'),
      });
      await rm(f.remote, {recursive: true, force: true});
      await expect(f.run(['start', '--json'])).rejects.toBeDefined();
    } finally {
      await rm(f.root, {recursive: true, force: true});
    }
  }, 90_000);
});
