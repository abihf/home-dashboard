import type { StartStopNotifier } from 'svelte/store';
import type { StatusResponse, Usage } from './api/status/types';

export interface Status extends Omit<StatusResponse, 'netUsage'> {
	upload: Usage;
	download: Usage;
}
const zero: Usage = { percent: 0, usage: 0 };

export const initialStatus: Status = {
	cpuUsage: 0,
	cpuTemp: 0,
	memUsage: zero,
	diskRoot: zero,
	diskMedia: zero,
	upload: zero,
	download: zero
};

export const fetchStatus: StartStopNotifier<Status> = function fetchStatus(set) {
	let lastFetch: number, lastRx: number, lastTx: number;
	const eventSource = new EventSource('/api/status');
	eventSource.addEventListener('error', (err) => console.error('status error', err));
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
};

function netSpeed(newValue: number, oldValue: number, deltaTime: number): Usage {
	const speed = (newValue - oldValue) / deltaTime;
	return { usage: speed, percent: speed / 100_000 };
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
