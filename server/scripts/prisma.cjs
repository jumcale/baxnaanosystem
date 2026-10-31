const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prismaCli = require.resolve('prisma/build/index.js', {
  paths: [path.resolve(__dirname, '..')],
});
const result = spawnSync(process.execPath, [prismaCli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
