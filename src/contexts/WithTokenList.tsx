'use client';

import {createContext, useCallback, useContext, useMemo, useState} from 'react';
import axios from 'axios';
import {useLocalStorageValue} from '@react-hookz/web';

import {useAsyncTrigger} from '../hooks/useAsyncTrigger';
import {useChainID} from '../hooks/useChainID';
import {toNormalizedBN} from '../utils/format';
import {toAddress} from '../utils/tools.address';

import type {AxiosResponse} from 'axios';
import type {Dispatch, ReactElement, SetStateAction} from 'react';
import type {TAddress} from '../types/address';
import type {TDict, TToken, TTokenList} from '../types/mixed';

export type TTokenListProps = {
	tokenList: TDict<TToken>;
	getToken: (tokenAddress: TAddress) => TToken | undefined;
	set_tokenList: Dispatch<SetStateAction<TDict<TToken>>>;
};
const defaultProps: TTokenListProps = {
	tokenList: {},
	getToken: (): TToken | undefined => undefined,
	set_tokenList: (): void => undefined
};

const TokenList = createContext<TTokenListProps>(defaultProps);
type TTokenListProviderProps = {
	children: ReactElement;
	lists?: string[];
};
export const WithTokenList = ({
	children,
	lists = [
		'https://raw.githubusercontent.com/SmolDapp/tokenLists/main/lists/etherscan.json',
		'https://raw.githubusercontent.com/SmolDapp/tokenLists/main/lists/tokenlistooor.json'
	]
}: TTokenListProviderProps): ReactElement => {
	const {safeChainID} = useChainID();
	const {value: extraTokenlist} = useLocalStorageValue<string[]>('extraTokenlists');
	const {value: extraTokens} = useLocalStorageValue<TTokenList['tokens']>('extraTokens');
	const [tokenList, set_tokenList] = useState<TDict<TToken>>({});
	const [tokenListExtra, set_tokenListExtra] = useState<TDict<TToken>>({});
	const [tokenListCustom, set_tokenListCustom] = useState<TDict<TToken>>({});
	const hashList = useMemo((): string => lists.join(','), [lists]);

	useAsyncTrigger(async (): Promise<void> => {
		const unhashedLists = hashList.split(',');
		const responses = await Promise.allSettled(
			unhashedLists.map(async (eachURI: string): Promise<AxiosResponse> => axios.get(eachURI))
		);
		const tokens: TTokenList['tokens'] = [];
		const fromList: TTokenList[] = [];

		for (const [index, response] of responses.entries()) {
			if (response.status === 'fulfilled') {
				tokens.push(...(response.value.data as TTokenList).tokens);
				fromList.push({...(response.value.data as TTokenList), uri: unhashedLists[index]});
			}
		}

		const tokenListTokens: TDict<TToken> = {};
		for (const eachToken of tokens) {
			if (!tokenListTokens[toAddress(eachToken.address)]) {
				if (eachToken.chainId !== safeChainID) {
					continue;
				}
				tokenListTokens[toAddress(eachToken.address)] = {
					address: eachToken.address,
					name: eachToken.name,
					symbol: eachToken.symbol,
					decimals: eachToken.decimals,
					chainID: eachToken.chainId,
					logoURI: eachToken.logoURI,
					value: 0,
					price: toNormalizedBN(0),
					balance: toNormalizedBN(0)
				};
			}
		}
		set_tokenList(tokenListTokens);
	}, [hashList, safeChainID]);

	useAsyncTrigger(async (): Promise<void> => {
		const tokenListTokens: TDict<TToken> = {};
		const fromList: TTokenList[] = [];

		for (const eachURI of extraTokenlist || []) {
			const [fromUserList] = await Promise.allSettled([axios.get(eachURI)]);

			if (fromUserList.status === 'fulfilled') {
				fromList.push({...(fromUserList.value.data as TTokenList), uri: eachURI});
				const {tokens} = fromUserList.value.data;
				for (const eachToken of tokens) {
					if (!tokenListTokens[toAddress(eachToken.address)]) {
						if (eachToken.chainId !== safeChainID) {
							continue;
						}
						tokenListTokens[toAddress(eachToken.address)] = {
							address: eachToken.address,
							name: eachToken.name,
							symbol: eachToken.symbol,
							decimals: eachToken.decimals,
							chainID: eachToken.chainId,
							logoURI: eachToken.logoURI,
							value: 0,
							price: toNormalizedBN(0),
							balance: toNormalizedBN(0)
						};
					}
				}
			}
		}
		set_tokenListExtra(tokenListTokens);
	}, [extraTokenlist, safeChainID]);

	useAsyncTrigger(async (): Promise<void> => {
		if (extraTokens === undefined) {
			return;
		}
		if ((extraTokens || []).length > 0) {
			const tokenListTokens: TDict<TToken> = {};
			for (const eachToken of extraTokens || []) {
				if (!tokenListTokens[toAddress(eachToken.address)]) {
					if (eachToken.chainId !== safeChainID) {
						continue;
					}
					tokenListTokens[toAddress(eachToken.address)] = {
						address: eachToken.address,
						name: eachToken.name,
						symbol: eachToken.symbol,
						decimals: eachToken.decimals,
						chainID: eachToken.chainId,
						logoURI: eachToken.logoURI,
						value: 0,
						price: toNormalizedBN(0),
						balance: toNormalizedBN(0)
					};
				}
			}
			set_tokenListCustom(tokenListTokens);
		}
	}, [extraTokens, safeChainID]);

	const aggregatedTokenList = useMemo(
		() => ({...tokenList, ...tokenListExtra, ...tokenListCustom}),
		[tokenList, tokenListExtra, tokenListCustom]
	);

	const getToken = useCallback(
		(tokenAddress: TAddress): TToken => {
			const fromTokenList = aggregatedTokenList[toAddress(tokenAddress)];
			if (fromTokenList) {
				return fromTokenList;
			}
			return {} as TToken;
		},
		[aggregatedTokenList]
	);

	const contextValue = useMemo(
		(): TTokenListProps => ({
			tokenList: aggregatedTokenList,
			set_tokenList,
			getToken
		}),
		[aggregatedTokenList, getToken]
	);

	return <TokenList.Provider value={contextValue}>{children}</TokenList.Provider>;
};

export const useTokenList = (): TTokenListProps => useContext(TokenList);
