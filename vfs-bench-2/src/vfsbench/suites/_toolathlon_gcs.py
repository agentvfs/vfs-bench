"""Cloud Storage on V1's pinned fake-gcs-server beside one isolated BigQuery
trial."""

import asyncio
import base64
import json
from contextlib import asynccontextmanager
from http.client import HTTPException
from pathlib import PurePosixPath
from urllib.parse import quote, urlencode
from uuid import uuid4

from ._toolathlon_bigquery import PROJECT, _docker, request_bytes

IMAGE = ('fsouza/fake-gcs-server:1.55.1@sha256:'
         '91afded49de804aa61b5f3eb6c7cd65205acf9e5c5e047cf0ba7d9507af806c8')


def _schema(required, optional=()):
    return {
        'inputSchema': {
            'type': 'object',
            'properties': {
                name: {
                    'type': 'string'
                }
                for name in (*required, *optional)
            },
            'required': list(required),
            'additionalProperties': False
        }
    }


def _workspace_path(value):
    path = PurePosixPath(value)
    if not path.is_absolute():
        path = PurePosixPath('/workspace') / path
    if not path.is_relative_to('/workspace') or '..' in path.parts:
        raise ValueError('Choose a file in /workspace')
    return str(path)


class Storage:
    tools = {
        'storage_list_buckets':
        _schema(()),
        'storage_create_bucket':
        _schema(('bucket_name', )),
        'storage_list_objects':
        _schema(('bucket_name', ), ('prefix', )),
        'storage_upload_file':
        _schema(('bucket_name', 'source_file_path', 'destination_blob_name')),
        'storage_download_file':
        _schema(('bucket_name', 'source_blob_name', 'destination_file_path')),
    }

    def __init__(self, bridge):
        self.bridge = bridge
        self.workspace = None

    async def request(self, method, path, body=b'', kind='application/json'):
        return await request_bytes(self.bridge, 4443, method, path, body, kind)

    async def _list(self, path, params):
        items = []
        while True:
            response = json.loads(await
                                  self.request('GET',
                                               path + '?' + urlencode(params)))
            items.extend(response.get('items', []))
            if not response.get('nextPageToken'):
                return items
            params = {**params, 'pageToken': response['nextPageToken']}

    async def create_bucket(self, name):
        return await self.request(
            'POST', '/storage/v1/b?' + urlencode({'project': PROJECT}),
            json.dumps({
                'name': name
            }).encode())

    async def download(self, bucket, name):
        return await self.request(
            'GET', f'/storage/v1/b/{quote(bucket, safe="")}/o/'
            f'{quote(name, safe="")}?alt=media')

    async def call(self, name, args):
        if name == 'storage_list_buckets':
            buckets = await self._list('/storage/v1/b', {'project': PROJECT})
            return '\n'.join('- ' + item['name'] for item in buckets)
        bucket = args['bucket_name']
        base = '/storage/v1/b/' + quote(bucket, safe='') + '/o'
        if name == 'storage_create_bucket':
            await self.create_bucket(bucket)
            return 'Created bucket ' + bucket
        if name == 'storage_list_objects':
            objects = await self._list(base,
                                       {'prefix': args.get('prefix', '')})
            return '\n'.join([
                f'Found {len(objects)} objects in bucket {bucket}',
                *('- ' + it['name'] for it in objects)
            ])
        if name == 'storage_upload_file':
            blob = args['destination_blob_name']
            data = await self.workspace.vfs.read(_workspace_path(
                args['source_file_path']),
                                                 raw=True)
            query = urlencode({'uploadType': 'media', 'name': blob})
            await self.request('POST', '/upload' + base + '?' + query, data,
                               'application/octet-stream')
            return f'Uploaded gs://{bucket}/{blob}'
        blob = args['source_blob_name']
        await self.workspace.vfs.write(
            _workspace_path(args['destination_file_path']), await
            self.download(bucket, blob))
        return f'Downloaded gs://{bucket}/{blob}'

    async def state(self):
        buckets = {}
        for item in await self._list('/storage/v1/b', {'project': PROJECT}):
            name = item['name']
            objects = {}
            for blob in await self._list(
                    '/storage/v1/b/' + quote(name, safe='') + '/o', {}):
                key = blob['name']
                objects[key] = {
                    'metadata':
                    blob,
                    'base64':
                    base64.b64encode(await self.download(name, key)).decode()
                }
            buckets[name] = {'metadata': item, 'objects': objects}
        return {'buckets': buckets}


@asynccontextmanager
async def serve(task, bigquery):
    from .toolathlon import _read
    manifest = json.loads(_read(task, 'shared/storage.json'))
    expected = {
        'project': PROJECT,
        'buckets': [{
            'name_file': 'groundtruth_workspace/bucket_name.txt'
        }]
    }
    empty = {'project': PROJECT, 'buckets': [{'prefix': 'promo-assets-for-b'}]}
    if manifest not in [expected, empty]:
        raise ValueError('Unexpected storage seed')
    name = 'vfsbench-storage-' + uuid4().hex
    service = Storage(bigquery.name)
    try:
        # Sharing the warehouse's isolated loopback lets its existing byte
        # transport reach Storage without publishing ports or enabling egress.
        await _docker(
            'run', '--detach', '--name', name, '--network',
            'container:' + bigquery.name, '--read-only', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp', '--pull',
            'never' if task._dataset._local_files_only else 'missing', IMAGE,
            '-backend', 'memory', '-scheme', 'http', '-port', '4443',
            '-external-url', 'http://127.0.0.1:4443', '-public-host',
            '127.0.0.1:4443')
        async with asyncio.timeout(35):
            while True:
                try:
                    await service._list('/storage/v1/b', {'project': PROJECT})
                    break
                except (RuntimeError, OSError, HTTPException):
                    if (await _docker('inspect', '--format',
                                      '{{.State.Running}}',
                                      name)).strip() != b'true':
                        raise RuntimeError(
                            'Cloud Storage emulator exited before '
                            'initialization')
                    await asyncio.sleep(0.2)
        if manifest == expected:
            bucket = _read(task,
                           'upstream/groundtruth_workspace/bucket_name.txt'
                           ).decode().strip()
            await service.create_bucket(bucket)
        yield service
    finally:
        try:
            await _docker('rm', '--force', name)
        except RuntimeError as exc:
            if 'No such container' not in str(exc):
                raise
