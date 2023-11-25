import { readable } from 'svelte/store';

interface ExtendedMessageEvent extends MessageEvent<string> {
	time: number;
}
export function createEventSource(url: string) {
	return readable<ExtendedMessageEvent>(undefined, (set) => {
		const es = new EventSource(url);
		es.addEventListener('message', (msg) => set({ ...msg, time: Date.now() }));
		return () => es.close();
	});
}
