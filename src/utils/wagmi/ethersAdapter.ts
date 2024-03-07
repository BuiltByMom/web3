import {providers} from 'ethers';
import {type Config, getClient} from '@wagmi/core';

import type {Chain, Client, Transport} from 'viem';

export function clientToProvider(
	client: Client<Transport, Chain>
): providers.JsonRpcProvider | providers.FallbackProvider {
	const {chain, transport} = client;
	const network = {
		chainId: chain.id,
		name: chain.name,
		ensAddress: chain.contracts?.ensRegistry?.address
	};
	if (transport.type === 'fallback') {
		return new providers.FallbackProvider(
			(transport.transports as ReturnType<Transport>[]).map(
				({value}) => new providers.JsonRpcProvider(value?.url, network)
			)
		);
	}
	return new providers.JsonRpcProvider(transport.url, network);
}

/** Action to convert a viem Public Client to an ethers.js Provider. */
export function getEthersProvider(
	config: Config,
	{chainId}: {chainId?: number} = {}
): providers.JsonRpcProvider | providers.FallbackProvider {
	const client = getClient(config, {chainId});
	return clientToProvider(client as Client<Transport, Chain>);
}
