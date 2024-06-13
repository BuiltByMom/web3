import {createStorage} from 'wagmi';
import {safe} from 'wagmi/connectors';
import {getDefaultConfig} from '@rainbow-me/rainbowkit';
import {
	coinbaseWallet,
	frameWallet,
	injectedWallet,
	metaMaskWallet,
	rainbowWallet,
	safeWallet,
	walletConnectWallet
} from '@rainbow-me/rainbowkit/wallets';
import {fallback, http, injected, noopStorage, unstable_connector, webSocket} from '@wagmi/core';
import {type Config} from '@wagmi/core';

import {getNetwork} from './utils';

import type {Transport} from 'viem';
import type {Chain} from 'viem/chains';
import type {_chains} from '@rainbow-me/rainbowkit/dist/config/getDefaultConfig';

let CONFIG: Config | undefined = undefined;

type TTransport = {[key: number]: Transport};
export function getConfig({chains}: {chains: Chain[]}): Config {
	if (CONFIG) {
		return CONFIG;
	}
	const config = getDefaultConfig({
		appName: (process.env.WALLETCONNECT_PROJECT_NAME as string) || '',
		projectId: process.env.WALLETCONNECT_PROJECT_ID as string,
		chains: chains as unknown as _chains,
		ssr: true,
		wallets: [
			{
				groupName: 'Popular',
				wallets: [
					injectedWallet,
					frameWallet,
					metaMaskWallet,
					walletConnectWallet,
					rainbowWallet,
					coinbaseWallet,
					safeWallet
				]
			}
		],
		storage: createStorage({
			// eslint-disable-next-line @typescript-eslint/prefer-optional-chain
			storage: typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : noopStorage
		}),
		transports: chains.reduce((acc: TTransport, chain) => {
			let wsURI = getNetwork(chain.id)?.defaultRPC;
			if (wsURI.startsWith('nd-')) {
				wsURI = wsURI.replace('nd-', 'ws-nd-');
			}
			if (wsURI.startsWith('infura.io')) {
				wsURI = wsURI.replace('v3', 'ws/v3');
			}
			if (wsURI.startsWith('chainstack.com')) {
				wsURI = 'ws' + wsURI;
			}
			const availableTransports: Transport[] = [];
			if (getNetwork(chain.id)?.defaultRPC) {
				availableTransports.push(http(getNetwork(chain.id)?.defaultRPC));
			}
			if (getNetwork(chain.id)?.rpcUrls['alchemy']?.http[0] && process.env.ALCHEMY_KEY) {
				availableTransports.push(
					http(`${getNetwork(chain.id)?.rpcUrls['alchemy'].http[0]}/${process.env.ALCHEMY_KEY}`)
				);
			}
			if (getNetwork(chain.id)?.rpcUrls['infura']?.http[0] && process.env.INFURA_PROJECT_ID) {
				availableTransports.push(
					http(`${getNetwork(chain.id)?.rpcUrls['infura'].http[0]}/${process.env.INFURA_PROJECT_ID}`)
				);
			}
			if (wsURI) {
				availableTransports.push(webSocket(wsURI));
			}

			acc[chain.id] = fallback([
				unstable_connector(safe),
				...availableTransports,
				unstable_connector(injected),
				http()
			]);
			return acc;
		}, {})
	});

	for (const chain of config.chains) {
		let wsURI = getNetwork(chain.id)?.defaultRPC;
		if (wsURI.startsWith('nd-')) {
			wsURI = wsURI.replace('nd-', 'ws-nd-');
		}
		if (wsURI.startsWith('infura.io')) {
			wsURI = wsURI.replace('v3', 'ws/v3');
		}
		if (wsURI.startsWith('chainstack.com')) {
			wsURI = 'ws' + wsURI;
		}
		const availableRPCs: string[] = [];
		const newRPC = process.env.RPC_URI_FOR?.[chain.id] || '';
		const newRPCBugged = process.env[`RPC_URI_FOR_${chain.id}`];
		const oldRPC = process.env.JSON_RPC_URI?.[chain.id] || process.env.JSON_RPC_URL?.[chain.id];
		const defaultJsonRPCURL = chain?.rpcUrls?.public?.http?.[0];
		const injectedRPC = newRPC || oldRPC || newRPCBugged || defaultJsonRPCURL || '';

		if (injectedRPC) {
			availableRPCs.push(injectedRPC);
		}
		if (chain?.rpcUrls['alchemy']?.http[0] && process.env.ALCHEMY_KEY) {
			availableRPCs.push(`${chain?.rpcUrls['alchemy'].http[0]}/${process.env.ALCHEMY_KEY}`);
		}
		if (chain?.rpcUrls['infura']?.http[0] && process.env.INFURA_PROJECT_ID) {
			availableRPCs.push(`${chain?.rpcUrls['infura'].http[0]}/${process.env.INFURA_PROJECT_ID}`);
		}
		if (!chain.rpcUrls.default) {
			chain.rpcUrls.default = {http: [], webSocket: []};
		}
		chain.rpcUrls.default.http = [...availableRPCs, ...(chain.rpcUrls.default?.http || [])];
		chain.rpcUrls.default.webSocket = [wsURI, ...(chain.rpcUrls.default.webSocket || [])];
	}

	CONFIG = config;
	return config;
}

export function retrieveConfig(): Config {
	if (CONFIG) {
		return CONFIG;
	}
	throw new Error('Config not set');
}
