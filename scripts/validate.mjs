import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const manifest=JSON.parse(await readFile('dist/.openai/hosting.json','utf8'));assert.ok(manifest.project_id);assert.equal(manifest.d1,'DB');assert.equal(manifest.r2,'BUCKET');
const worker=await import('../dist/server/index.js');assert.equal(typeof worker.default.fetch,'function');const response=await worker.default.fetch(new Request('https://example.test/'),{},{});assert.equal(response.status,200);assert.match(await response.text(),/Рейс|рейс/);console.log('Проверены ESM Worker, манифест и HTML.');
