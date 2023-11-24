import { readable } from 'svelte/store';
import type { StatusResponse, Usage } from './api/status/types';

interface Status extends Omit<StatusResponse, 'netUsage'> {
	upload: Usage;
	download: Usage;
}
const zero: Usage = { percent: 0, usage: 0 };

export const status = readable<Status>(
	{
		cpuUsage: 0,
		cpuTemp: 0,
		memUsage: zero,
		diskMedia: zero,
		diskRoot: zero,
		upload: zero,
		download: zero
	},
	(set) => {
		// let abortController: AbortController;
		let lastFetch: number, lastRx: number, lastTx: number;
		const eventSource = new EventSource('/api/status');
		eventSource.addEventListener('error', (err) => console.error('kenapa', err));
		eventSource.addEventListener('message', (msg) => {
			const { netUsage, ...data }: StatusResponse = JSON.parse(msg.data);
			let upload: Usage = zero;
			let download: Usage = zero;
			const now = Date.now();
			if (lastFetch) {
				const deltaTime = (now - lastFetch) / 1000;
				upload = netSpeed(netUsage.lastTx, lastTx, deltaTime);
				download = netSpeed(netUsage.lastRx, lastRx, deltaTime);
			}
			lastFetch = now;
			lastTx = netUsage.lastTx;
			lastRx = netUsage.lastRx;
			set({ ...data, upload, download });
		});
		return () => eventSource.close();

		// async function fetchStatus() {
		// 	abortController?.abort();
		// 	abortController = new AbortController();
		// 	try {
		// 		const res = await fetch('/api/status', { cache: 'no-cache' });
		// 		if (res.status !== 200) throw new Error(`Invalid status response ${res.status}`);
		// 		const { netUsage, ...data }: StatusResponse = await res.json();
		// 		let upload: Usage = zero;
		// 		let download: Usage = zero;
		// 		const now = Date.now();
		// 		if (lastFetch) {
		// 			const deltaTime = (now - lastFetch) / 1000;
		// 			upload = netSpeed(netUsage.lastTx, lastTx, deltaTime);
		// 			download = netSpeed(netUsage.lastRx, lastRx, deltaTime);
		// 		}
		// 		lastFetch = now;
		// 		lastTx = netUsage.lastTx;
		// 		lastRx = netUsage.lastRx;
		// 		set({ ...data, upload, download });
		// 	} catch (err) {
		// 		console.error('Error when fetching status', err);
		// 	}
		// }
		// fetchStatus();
		// const handler = setInterval(fetchStatus, 2000);
		// return () => {
		// 	clearInterval(handler);
		// 	abortController?.abort();
		// };
	}
);

function netSpeed(newValue: number, oldValue: number, deltaTime: number): Usage {
	const speed = (newValue - oldValue) / deltaTime;
	return { usage: speed, percent: speed / 10_000_000 };
}

const SIZE_SUFFIX = 'KMGT';
export function normalizeSize(size: number, digits = 2) {
	let suffixIdx = -1;
	let normalized = size;
	while (normalized > 1024) {
		normalized /= 1024;
		suffixIdx++;
	}
	const suffix = suffixIdx >= 0 ? SIZE_SUFFIX[suffixIdx] : '';
	return `${normalized.toFixed(digits)} ${suffix}`;
}
