export interface Usage {
	usage: bigint;
	percent: number;
}

export interface NetUsage {
	lastTx: bigint;
	lastRx: bigint;
}

export interface StatusResponse {
	cpuUsage: number;
	cpuTemp: number;
	memUsage: Usage;
	diskRoot: Usage;
	diskMedia: Usage;
	netUsage: NetUsage;
}
