import { RequestHandler } from '@sveltejs/kit';

const subscription = new Map<symbol, () => void>();

export const GET: RequestHandler = () => {
	const id = Symbol();
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue('event: data\n');
			subscription.set(id, function restart() {
				controller.enqueue(`data: ${Date.now()}\n\n`);
			});
		},
		cancel() {
			subscription.delete(id);
		}
	});
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream'
		}
	});
};

export const POST: RequestHandler = () => {
	for (const [, fn] of subscription) {
		fn();
	}
	return Response.json({ ok: subscription.size });
};
