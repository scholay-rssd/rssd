#!/usr/bin/env python3
"""Forced SSH command: verify one fixed restic repository as its unprivileged owner.

Accepts only `verify <64 hex snapshot id>` in SSH_ORIGINAL_COMMAND. The password
arrives over encrypted stdin and is not stored on the archive host.
"""
import json
import os
from pathlib import Path
import pwd
import re
import subprocess
import sys

REPOSITORY = '/var/lib/scholay-archives/today/repository'
RESTIC = '/usr/local/bin/restic-scholay'


def main():
    match = re.fullmatch(r'verify ([0-9a-f]{64})', os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    if not match:
        raise ValueError('Only archive verification is allowed')
    account = pwd.getpwnam('today-archive')
    os.initgroups(account.pw_name, account.pw_gid)
    os.setgid(account.pw_gid)
    os.setuid(account.pw_uid)
    os.chdir('/var/lib/scholay-archives/today')
    os.umask(0o077)
    os.nice(19)
    password = sys.stdin.buffer.readline(256)
    if not password.endswith(b'\n') or len(password) < 32:
        raise ValueError('Invalid password input')
    env = {'PATH': '/usr/bin:/bin', 'GOMAXPROCS': '1', 'GOMEMLIMIT': '240MiB', 'HOME': '/today'}
    command = [RESTIC, '--repo', REPOSITORY, '--password-file', '/dev/stdin', '--no-cache']

    def run(*args):
        result = subprocess.run(command + list(args), input=password, capture_output=True, env=env, timeout=7200)
        if result.returncode:
            raise RuntimeError('Archive verification failed: ' + result.stderr.decode(errors='replace')[-1000:])
        return result.stdout

    config = json.loads(run('cat', 'config'))
    snapshot = match.group(1)
    json.loads(run('cat', 'snapshot', snapshot))
    run('check', '--read-data')
    print(json.dumps({'verifiedSnapshot': snapshot, 'repositoryId': config['id'], 'readData': True}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'error': str(error)}), flush=True)
        sys.exit(1)
