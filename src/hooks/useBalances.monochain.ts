import {useCallback, useMemo, useRef, useState} from 'react';
import {useChainId} from 'wagmi';
import {deserialize, serialize} from '@wagmi/core';

import {useWeb3} from '../contexts/useWeb3';
import {toAddress} from '../utils/tools.address';
import {isZero, isZeroAddress} from '../utils/tools.is';
import {useAsyncTrigger} from './useAsyncTrigger';
import {getBalances} from './useBalances.multichains';

import type {DependencyList} from 'react';
import type {Connector} from 'wagmi';
import type {TAddress} from '../types/address';
import type {TChainTokens, TDefaultStatus, TDict, TNDict, TToken} from '../types/mixed';

/*******************************************************************************
 ** Request, Response and helpers for the useBalances hook.
 ******************************************************************************/
export type TUseBalancesTokens = {
	address: TAddress;
	chainID: number;
	decimals?: number;
	name?: string;
	symbol?: string;
	for?: string;
};
export type TUseBalancesReq = {
	key?: string | number;
	tokens: TUseBalancesTokens[];
	effectDependencies?: DependencyList;
	provider?: Connector;
};
export type TUseBalancesRes = {
	data: TChainTokens;
	onUpdate: () => Promise<TChainTokens>;
	onUpdateSome: (token: TUseBalancesTokens[]) => Promise<TChainTokens>;
	error?: Error;
	status: 'error' | 'loading' | 'success' | 'unknown';
	nonce: number;
} & TDefaultStatus;

type TDataRef = {
	nonce: number;
	address: TAddress;
	balances: TChainTokens;
};

/*******************************************************************************
 ** Default status for the loading state.
 ******************************************************************************/
const defaultStatus = {
	isLoading: false,
	isFetching: false,
	isSuccess: false,
	isError: false,
	isFetched: false,
	isRefetching: false
};

/***************************************************************************
 ** This hook can be used to fetch balance information for any ERC20 tokens.
 **************************************************************************/
export function useBalances(props?: TUseBalancesReq): TUseBalancesRes {
	const {address: userAddress} = useWeb3();
	const chainID = useChainId();
	const [status, set_status] = useState<TDefaultStatus>(defaultStatus);
	const [error, set_error] = useState<Error | undefined>(undefined);
	const [balances, set_balances] = useState<TChainTokens>({});
	const data = useRef<TDataRef>({nonce: 0, address: toAddress(), balances: {}});
	const stringifiedTokens = useMemo((): string => serialize(props?.tokens || []), [props?.tokens]);

	const updateBalancesCall = useCallback(
		(currentUserAddress: TAddress, chainID: number, newRawData: TDict<TToken>): TChainTokens => {
			if (toAddress(currentUserAddress) !== data?.current?.address) {
				data.current = {
					address: toAddress(currentUserAddress),
					balances: {},
					nonce: 0
				};
			}
			data.current.address = toAddress(currentUserAddress);

			for (const [address, element] of Object.entries(newRawData)) {
				if (!data.current.balances[chainID]) {
					data.current.balances[chainID] = {};
				}
				data.current.balances[chainID][address] = {
					...data.current.balances[chainID][address],
					...element
				};
			}
			data.current.nonce += 1;

			set_balances(
				(b): TChainTokens => ({
					...b,
					[chainID]: {
						...(b[chainID] || {}),
						...data.current.balances[chainID]
					}
				})
			);
			return data.current.balances;
		},
		[]
	);

	/***************************************************************************
	 ** onUpdate will take the stringified tokens and fetch the balances for each
	 ** token. It will then update the balances state with the new balances.
	 ** This takes the whole list and is not optimized for performance, aka not
	 ** send in a worker.
	 **************************************************************************/
	const onUpdate = useCallback(async (): Promise<TChainTokens> => {
		const tokenList = (deserialize(stringifiedTokens) || []) as TUseBalancesTokens[];
		const tokens = tokenList.filter(({address}: TUseBalancesTokens): boolean => !isZeroAddress(address));
		if (isZero(tokens.length)) {
			return {};
		}
		set_status({
			...defaultStatus,
			isLoading: true,
			isFetching: true,
			isRefetching: defaultStatus.isFetched
		});

		const chunks = [];
		for (let i = 0; i < tokens.length; i += 5_000) {
			chunks.push(tokens.slice(i, i + 5_000));
		}

		const tokensPerChainID: TNDict<TUseBalancesTokens[]> = {};
		const alreadyAdded: TNDict<TDict<boolean>> = {};
		for (const token of tokens) {
			if (token.chainID !== chainID) {
				continue;
			}
			if (!tokensPerChainID[chainID]) {
				tokensPerChainID[chainID] = [];
			}
			if (!alreadyAdded[chainID]) {
				alreadyAdded[chainID] = {};
			}
			if (alreadyAdded[chainID][toAddress(token.address)]) {
				continue;
			}
			tokensPerChainID[chainID].push(token);
			alreadyAdded[chainID][toAddress(token.address)] = true;
		}

		const updated: TChainTokens = {};
		for (const [, tokens] of Object.entries(tokensPerChainID)) {
			const chunks = [];
			for (let i = 0; i < tokens.length; i += 500) {
				chunks.push(tokens.slice(i, i + 500));
			}

			for (const chunkTokens of chunks) {
				const [newRawData, err] = await getBalances(chainID || 1, userAddress, chunkTokens);
				if (err) {
					set_error(err as Error);
				}

				if (toAddress(userAddress) !== data?.current?.address) {
					data.current = {
						address: toAddress(userAddress),
						balances: {},
						nonce: 0
					};
				}
				data.current.address = toAddress(userAddress);
				for (const [address, element] of Object.entries(newRawData)) {
					if (!updated[chainID]) {
						updated[chainID] = {};
					}
					updated[chainID][address] = element;

					if (!data.current.balances[chainID]) {
						data.current.balances[chainID] = {};
					}
					data.current.balances[chainID][address] = {
						...data.current.balances[chainID][address],
						...element
					};
				}
				data.current.nonce += 1;
			}

			set_balances(
				(b): TChainTokens => ({
					...b,
					[chainID]: {
						...(b[chainID] || {}),
						...data.current.balances[chainID]
					}
				})
			);
			set_status({...defaultStatus, isSuccess: true, isFetched: true});
		}

		return updated;
	}, [stringifiedTokens, userAddress, chainID]);

	/***************************************************************************
	 ** onUpdateSome takes a list of tokens and fetches the balances for each
	 ** token. Even if it's not optimized for performance, it should not be an
	 ** issue as it should only be used for a little list of tokens.
	 **************************************************************************/
	const onUpdateSome = useCallback(
		async (tokenList: TUseBalancesTokens[]): Promise<TChainTokens> => {
			set_status({
				...defaultStatus,
				isLoading: true,
				isFetching: true,
				isRefetching: defaultStatus.isFetched
			});
			const chains: number[] = [];
			const tokens = tokenList.filter(({address}: TUseBalancesTokens): boolean => !isZeroAddress(address));
			const tokensPerChainID: TNDict<TUseBalancesTokens[]> = {};
			const alreadyAdded: TNDict<TDict<boolean>> = {};

			for (const token of tokens) {
				if (token.chainID !== chainID) {
					continue;
				}
				if (!tokensPerChainID[chainID]) {
					tokensPerChainID[chainID] = [];
				}
				if (!alreadyAdded[chainID]) {
					alreadyAdded[chainID] = {};
				}
				if (alreadyAdded[chainID][toAddress(token.address)]) {
					continue;
				}

				tokensPerChainID[chainID].push(token);
				alreadyAdded[chainID][toAddress(token.address)] = true;
				if (!chains.includes(chainID)) {
					chains.push(chainID);
				}
			}

			const updated: TChainTokens = {};
			for (const [, tokens] of Object.entries(tokensPerChainID)) {
				const chunks = [];
				for (let i = 0; i < tokens.length; i += 500) {
					chunks.push(tokens.slice(i, i + 500));
				}
				for (const chunkTokens of chunks) {
					const [newRawData, err] = await getBalances(chainID || 1, toAddress(userAddress), chunkTokens);
					if (err) {
						set_error(err as Error);
					}
					if (toAddress(userAddress) !== data?.current?.address) {
						data.current = {
							address: toAddress(userAddress),
							balances: {},
							nonce: 0
						};
					}
					data.current.address = toAddress(userAddress);

					for (const [address, element] of Object.entries(newRawData)) {
						if (!updated[chainID]) {
							updated[chainID] = {};
						}
						updated[chainID][address] = element;

						if (!data.current.balances[chainID]) {
							data.current.balances[chainID] = {};
						}
						data.current.balances[chainID][address] = {
							...data.current.balances[chainID][address],
							...element
						};
					}
					data.current.nonce += 1;
				}
			}

			set_balances(previous => {
				const updated = {...previous};
				for (const [chainID, chainData] of Object.entries(data.current.balances)) {
					updated[Number(chainID)] = {...updated[Number(chainID)], ...chainData};
				}
				return updated;
			});
			set_status({...defaultStatus, isSuccess: true, isFetched: true});
			return updated;
		},
		[userAddress, chainID]
	);

	/***************************************************************************
	 ** Everytime the stringifiedTokens change, we need to update the balances.
	 ** This is the main hook and is optimized for performance, using a worker
	 ** to fetch the balances, preventing the UI to freeze.
	 **************************************************************************/
	useAsyncTrigger(async (): Promise<void> => {
		set_status({
			...defaultStatus,
			isLoading: true,
			isFetching: true,
			isRefetching: defaultStatus.isFetched
		});

		const tokens = (JSON.parse(stringifiedTokens) || []) as TUseBalancesTokens[];
		const tokensPerChainID: TNDict<TUseBalancesTokens[]> = {};
		const alreadyAdded: TNDict<TDict<boolean>> = {};
		for (const token of tokens) {
			if (token.chainID !== chainID) {
				continue;
			}
			if (!tokensPerChainID[chainID]) {
				tokensPerChainID[chainID] = [];
			}
			if (!alreadyAdded[chainID]) {
				alreadyAdded[chainID] = {};
			}
			if (alreadyAdded[chainID][toAddress(token.address)]) {
				continue;
			}
			tokensPerChainID[chainID].push(token);
			alreadyAdded[chainID][toAddress(token.address)] = true;
		}

		for (const [, tokens] of Object.entries(tokensPerChainID)) {
			const chunks = [];
			for (let i = 0; i < tokens.length; i += 500) {
				chunks.push(tokens.slice(i, i + 500));
			}
			const allPromises = [];
			for (const chunkTokens of chunks) {
				allPromises.push(
					getBalances(chainID, userAddress, chunkTokens).then(async ([newRawData, err]): Promise<void> => {
						updateBalancesCall(toAddress(userAddress), chainID, newRawData);
						set_error(err);
					})
				);
			}
			await Promise.all(allPromises);
		}

		set_status({...defaultStatus, isSuccess: true, isFetched: true});
	}, [stringifiedTokens, userAddress, updateBalancesCall, chainID]);

	const contextValue = useMemo(
		(): TUseBalancesRes => ({
			data: balances || {},
			onUpdate: onUpdate,
			onUpdateSome: onUpdateSome,
			error,
			isLoading: status.isLoading,
			isFetching: status.isFetching,
			isSuccess: status.isSuccess,
			isError: status.isError,
			isFetched: status.isFetched,
			isRefetching: status.isRefetching,
			nonce: data.current.nonce,
			status: status.isError
				? 'error'
				: status.isLoading || status.isFetching
					? 'loading'
					: status.isSuccess
						? 'success'
						: 'unknown'
		}),
		[
			balances,
			error,
			onUpdate,
			onUpdateSome,
			status.isError,
			status.isFetched,
			status.isFetching,
			status.isLoading,
			status.isRefetching,
			status.isSuccess
		]
	);

	return contextValue;
}
