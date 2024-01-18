import {createPublicClient, http} from 'viem';
import * as wagmiChains from 'viem/chains';

import {
	ARB_WETH_TOKEN_ADDRESS,
	BASE_WETH_TOKEN_ADDRESS,
	OPT_WETH_TOKEN_ADDRESS,
	WETH_TOKEN_ADDRESS,
	WFTM_TOKEN_ADDRESS
} from '../constants';
import {toAddress} from '../tools.address';
import {localhost} from './networks';

import type {Chain, PublicClient} from 'viem';
import type {TAddress} from '../../types/address';
import type {TDict, TNDict} from '../../types/mixed';

export type TChainContract = {
	address: TAddress;
	blockCreated?: number;
};

/***************************************************************************************************
 ** wrappedChainTokens contains the data for the wrapped tokens used by the given chain, with the
 ** name of the token, the symbol, the decimals, the address, the name of the coin, and the symbol
 ** of the coin.
 **************************************************************************************************/
export type TWrappedChainToken = {
	address: TAddress; //Token address
	decimals: number; //Token decimals
	symbol: string; //Token symbol
	name: string; //Token name
	coinName: string; //Coin name (e.g. Ether)
	coinSymbol: string; //Coin symbol (e.g. ETH)
};
const wrappedChainTokens: {[key: number]: TWrappedChainToken} = {
	1: {
		address: WETH_TOKEN_ADDRESS,
		decimals: 18,
		symbol: 'wETH',
		name: 'Wrapped Ether',
		coinName: 'Ether',
		coinSymbol: 'ETH'
	},
	10: {
		address: OPT_WETH_TOKEN_ADDRESS,
		decimals: 18,
		symbol: 'wETH',
		name: 'Wrapped Ether',
		coinName: 'Ether',
		coinSymbol: 'ETH'
	},
	137: {
		address: toAddress('0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'),
		decimals: 18,
		symbol: 'wMatic',
		name: 'Wrapped Matic',
		coinName: 'Matic',
		coinSymbol: 'MATIC'
	},
	250: {
		address: WFTM_TOKEN_ADDRESS,
		decimals: 18,
		symbol: 'wFTM',
		name: 'Wrapped Fantom',
		coinName: 'Fantom',
		coinSymbol: 'FTM'
	},
	1101: {
		address: toAddress('0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9'),
		decimals: 18,
		symbol: 'wETH',
		name: 'Wrapped Ether',
		coinName: 'Ether',
		coinSymbol: 'ETH'
	},
	8453: {
		address: BASE_WETH_TOKEN_ADDRESS,
		decimals: 18,
		symbol: 'wETH',
		name: 'Wrapped Ether',
		coinName: 'Ether',
		coinSymbol: 'ETH'
	},
	42161: {
		address: ARB_WETH_TOKEN_ADDRESS,
		decimals: 18,
		symbol: 'wETH',
		name: 'Wrapped Ether',
		coinName: 'Ether',
		coinSymbol: 'ETH'
	},
	1337: {
		address: WETH_TOKEN_ADDRESS,
		decimals: 18,
		symbol: 'wETH',
		name: 'Wrapped Ether',
		coinName: 'Ether',
		coinSymbol: 'ETH'
	}
};

/***************************************************************************************************
 ** Extended Chain type is used to add additional properties to the basic wagmi Chain type.
 ** Ee need to add:
 ** - the default RPC and block explorer URLs for each chain.
 ** - the wrapped token data for each chain.
 **************************************************************************************************/
export type TExtendedChain = Chain & {
	defaultRPC: string;
	defaultBlockExplorer: string;
	contracts: {
		wrappedToken?: TWrappedChainToken;
	} & TDict<TChainContract>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isChain = (chain: wagmiChains.Chain | any): chain is wagmiChains.Chain => {
	return chain.id !== undefined;
};

function initIndexedWagmiChains(): TNDict<TExtendedChain> {
	const _indexedWagmiChains: TNDict<TExtendedChain> = {};
	for (const chain of Object.values(wagmiChains)) {
		if (isChain(chain)) {
			let extendedChain = chain as unknown as TExtendedChain;
			if (extendedChain.id === 1337) {
				extendedChain = localhost as unknown as TExtendedChain;
			}

			extendedChain.contracts = {
				...extendedChain.contracts,
				wrappedToken: wrappedChainTokens[extendedChain.id]
			};
			extendedChain.defaultRPC =
				process.env.JSON_RPC_URL?.[extendedChain.id] || extendedChain?.rpcUrls?.public?.http?.[0] || '';
			extendedChain.defaultBlockExplorer =
				extendedChain.blockExplorers?.etherscan?.url ||
				extendedChain.blockExplorers?.default.url ||
				'https://etherscan.io';
			_indexedWagmiChains[extendedChain.id] = extendedChain;
		}
	}
	return _indexedWagmiChains;
}
export const indexedWagmiChains: TNDict<TExtendedChain> = initIndexedWagmiChains();

export function getNetwork(chainID: number): TExtendedChain {
	if (!indexedWagmiChains[chainID]) {
		throw new Error(`Chain ${chainID} is not supported`);
	}
	return indexedWagmiChains[chainID];
}

export function getClient(chainID: number): PublicClient {
	if (!indexedWagmiChains[chainID]) {
		throw new Error(`Chain ${chainID} is not supported`);
	}
	let url = process.env.JSON_RPC_URL?.[chainID] || indexedWagmiChains?.[chainID]?.rpcUrls?.public?.http?.[0] || '';
	const urlAsNodeURL = new URL(url);
	let headers = {};
	if (urlAsNodeURL.username && urlAsNodeURL.password) {
		headers = {
			Authorization: `Basic ${btoa(urlAsNodeURL.username + ':' + urlAsNodeURL.password)}`
		};
		url = urlAsNodeURL.href.replace(`${urlAsNodeURL.username}:${urlAsNodeURL.password}@`, '');
		return createPublicClient({
			chain: indexedWagmiChains[chainID],
			transport: http(url, {fetchOptions: {headers}})
		});
	}
	return createPublicClient({chain: indexedWagmiChains[chainID], transport: http(url)});
}
