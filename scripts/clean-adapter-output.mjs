import { rmSync } from 'node:fs';

for (const path of ['.svelte-kit/cloudflare', '.svelte-kit/cloudflare-tmp']) {
	rmSync(path, { recursive: true, force: true });
}
