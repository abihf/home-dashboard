import type { RequestHandler } from "@sveltejs/kit";
import sys, { type Systeminformation } from "systeminformation";
import type { NetUsage, StatusResponse, Usage } from "./types";

async function query() {
	const [load, mem, fsSizes, temperature, net] = await Promise.all([
		sys.currentLoad(),
		sys.mem(),
		sys.fsSize(),
		sys.cpuTemperature(),
		sys.networkStats("eth0"),
	]);

	const ethernet = net[0];
	const netUsage: NetUsage = {
		lastTx: ethernet.tx_bytes,
		lastRx: ethernet.rx_bytes,
	};

	const status: StatusResponse = {
		cpuUsage: load.currentLoad,
		cpuTemp: temperature.main,
		memUsage: { usage: mem.active, percent: (100 * mem.active) / mem.total },
		diskRoot: diskUsage(fsSizes.find((fs) => fs.mount === "/")),
		diskMedia: diskUsage(fsSizes.find((fs) => fs.mount === "/media/data")),
		netUsage,
	};
	return status;
}

export const GET: RequestHandler = async () => {
	let handler: number;
	let canceled = false;

	const stream = new ReadableStream({
		start(controller) {
			async function queryAndUpdate() {
				const data = await query();
				const json = JSON.stringify(data);
				if (!canceled) controller.enqueue(`data: ${json}\n\n`);
			}
			handler = setInterval(queryAndUpdate, 1000);
			queryAndUpdate();
		},
		cancel() {
			canceled = true;
			clearInterval(handler);
		},
	});

	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream",
		},
	});
};

function diskUsage(fs?: Systeminformation.FsSizeData): Usage {
	if (!fs) return { usage: 0, percent: 0 };
	return {
		usage: fs.used,
		percent: (100 * fs.used) / fs.size,
	};
}
