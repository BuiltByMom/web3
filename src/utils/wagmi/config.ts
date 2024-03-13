import {createStorage} from 'wagmi';
import {safe} from 'wagmi/connectors';
import {getDefaultConfig} from '@rainbow-me/rainbowkit';
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
			if (getNetwork(chain.id)?.rpcUrls['alchemy'].http[0] && process.env.ALCHEMY_KEY) {
				availableTransports.push(
					http(`${getNetwork(chain.id)?.rpcUrls['alchemy'].http[0]}/${process.env.ALCHEMY_KEY}`)
				);
			}
			if (getNetwork(chain.id)?.rpcUrls['infura'].http[0] && process.env.INFURA_PROJECT_ID) {
				availableTransports.push(
					http(`${getNetwork(chain.id)?.rpcUrls['infura'].http[0]}/${process.env.INFURA_PROJECT_ID}`)
				);
			}
			if (wsURI) {
				availableTransports.push(webSocket(wsURI));
			}

			acc[chain.id] = fallback([
				unstable_connector(safe),
				unstable_connector(injected),
				http(),
				...availableTransports
			]);
			return acc;
		}, {})
	});

	CONFIG = config;
	return config;
}

export function retrieveConfig(): Config {
	if (CONFIG) {
		return CONFIG;
	}
	throw new Error('Config not set');
}
